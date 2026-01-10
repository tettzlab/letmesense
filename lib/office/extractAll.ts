/**
 * All-in-one entry point for Office document text extraction.
 * Coordinates loading, parsing, analysis, and extraction.
 */

import { obs } from '../observability/index.js'
import { SemanticMetrics, SpanNames } from '../observability/types.js'
import { analyzeDocument } from './analyze.js'
import { OfficeExtractionError, OfficeLoadError } from './errors.js'
import {
  concatenateExtracted,
  type ExtractedUnit,
  extractText,
  getExtractionErrors,
} from './extractText.js'
import { type LoadOptions, type LoadResult, loadOfficeDocument } from './loader.js'
import {
  extractMetadata,
  type ParsedDocument,
  type ParseOptions,
  parseOfficeBuffer,
} from './parser.js'
import { getDominantLanguage, splitIntoRuns } from './splitRuns.js'
import type {
  AnalyzeOptions,
  ContentAttributes,
  ContentError,
  ContentRun,
  DocumentMetadata,
  ExtractOptions,
  ExtractResult,
  OfficeInput,
  ProgressCallbacks,
} from './types.js'

/** Combined options for the full extraction pipeline */
export interface ExtractAllOptions extends ExtractOptions, AnalyzeOptions, LoadOptions {
  /** Parsing options */
  parseOptions?: ParseOptions

  /** Separator between content units in output */
  unitSeparator?: string

  /** Fail if any unit has an error */
  strict?: boolean

  /** Progress callbacks */
  progress?: ProgressCallbacks
}

/** Default separator between units */
const DEFAULT_UNIT_SEPARATOR = '\n\n---\n\n'

/**
 * Extract text from an Office document.
 *
 * This is the main entry point for the letmesense-office library.
 * It coordinates the full pipeline:
 * 1. Load document from file/URL/buffer
 * 2. Parse with OfficeParser
 * 3. Analyze content units
 * 4. Split into runs
 * 5. Extract text
 * 6. Return combined result
 *
 * @param input - File path, URL, or buffer
 * @param options - Extraction options
 * @returns Extraction result with text, metadata, and errors
 *
 * @example
 * ```ts
 * // From file
 * const result = await extractFromOffice('presentation.pptx')
 * console.log(result.text)
 *
 * // From URL with options
 * const result = await extractFromOffice('https://example.com/doc.docx', {
 *   includeNotes: true,
 *   strict: false,
 * })
 *
 * // From buffer
 * const buffer = await fs.readFile('data.xlsx')
 * const result = await extractFromOffice(buffer, { format: 'xlsx' })
 * ```
 */
export async function extractFromOffice(
  input: OfficeInput,
  options: ExtractAllOptions = {},
): Promise<ExtractResult> {
  const { logger, tracer, metrics } = obs('office')

  return tracer.startSpan(SpanNames.OFFICE_EXTRACT, async (span) => {
    const startTime = performance.now()

    const {
      // Load options
      format: inputFormat,
      timeout,

      // Parse options
      parseOptions,

      // Analyze options
      minCharsForTextRich,
      minCharsForLangDetect,
      maxTextSampleChars,

      // Extract options
      ocr,
      ocrLang,
      unitTimeout,
      includeNotes,
      slideRange,
      sheetNames,
      headers,

      // Output options
      unitSeparator = DEFAULT_UNIT_SEPARATOR,
      strict = false,

      // Progress
      progress,
    } = options

    const allErrors: ContentError[] = []

    // Step 1: Load document
    let loadResult: LoadResult
    try {
      loadResult = await tracer.startSpan(SpanNames.OFFICE_LOAD, async (loadSpan) => {
        const result = await loadOfficeDocument(input, { format: inputFormat, timeout })
        loadSpan.setAttribute('source', result.source)
        loadSpan.setAttribute('format', result.format)
        return result
      })
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.setError('Failed to load document')
      metrics
        .counter(SemanticMetrics.OFFICE_EXTRACTIONS_COUNT)
        .add(1, { status: 'failure', format: inputFormat ?? 'unknown' })
      logger.error({ err }, 'Office extraction failed during load')
      throw err instanceof OfficeExtractionError
        ? err
        : new OfficeLoadError('Failed to load document', err as Error)
    }

    const { bytes, format, source } = loadResult
    span.setAttribute('source', source)
    span.setAttribute('format', format)
    logger.info({ source, format }, 'Starting Office extraction')

    // Step 2: Parse document
    let parsed: ParsedDocument
    try {
      parsed = await tracer.startSpan(SpanNames.OFFICE_PARSE, async () => {
        return parseOfficeBuffer(bytes, {
          newlineDelimiter: '\n\n',
          extractAttachments: true,
          ignoreNotes: !includeNotes,
          ...parseOptions,
        })
      })
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.setError('Failed to parse document')
      metrics
        .counter(SemanticMetrics.OFFICE_EXTRACTIONS_COUNT)
        .add(1, { status: 'failure', format })
      logger.error({ err }, 'Office extraction failed during parse')
      throw err instanceof OfficeExtractionError
        ? err
        : new OfficeExtractionError('Failed to parse document', err as Error, 'parse')
    }

    // Step 3: Extract metadata
    const metadata: DocumentMetadata = extractMetadata(parsed)

    // Step 4: Analyze content units
    const attributes = await tracer.startSpan(SpanNames.OFFICE_ANALYZE, async (analyzeSpan) => {
      const result = await analyzeDocument(parsed, format, {
        minCharsForTextRich,
        minCharsForLangDetect,
        maxTextSampleChars,
      })
      analyzeSpan.setAttribute('unitCount', result.length)
      return result
    })

    span.setAttribute('unitCount', attributes.length)

    // Report analysis progress
    if (progress?.onUnitAnalyzed) {
      for (let i = 0; i < attributes.length; i++) {
        progress.onUnitAnalyzed(i, attributes.length)
      }
    }

    // Collect analysis errors
    for (const attr of attributes) {
      if (attr.error) {
        allErrors.push(attr.error)
      }
    }

    // Step 5: Split into runs
    const runs = splitIntoRuns(attributes)
    span.setAttribute('runCount', runs.length)

    // Record unit kind metrics
    for (const attr of attributes) {
      metrics.counter(SemanticMetrics.OFFICE_UNITS_COUNT).add(1, { kind: attr.kind })
    }

    // Step 6: Extract text
    const extracted = await extractText(parsed, format, attributes, {
      ocr,
      ocrLang,
      unitTimeout,
      includeNotes,
      slideRange,
      sheetNames,
      headers,
    })

    // Report extraction progress
    if (progress?.onRunExtracted) {
      for (let i = 0; i < runs.length; i++) {
        progress.onRunExtracted(i, runs.length)
      }
    }

    // Collect extraction errors
    const extractErrors = getExtractionErrors(extracted)
    allErrors.push(...extractErrors)

    // Step 7: Concatenate text
    const text = concatenateExtracted(extracted, unitSeparator)

    // Check for strict mode
    if (strict && allErrors.length > 0) {
      const errorUnits = allErrors.map((e) => e.unitIndex + 1).join(', ')
      metrics
        .counter(SemanticMetrics.OFFICE_EXTRACTIONS_COUNT)
        .add(1, { status: 'failure', format })
      logger.error({ errorCount: allErrors.length }, 'Office extraction failed in strict mode')
      throw new OfficeExtractionError(
        `Extraction failed for ${allErrors.length} unit(s): ${errorUnits}`,
        undefined,
        'extract',
      )
    }

    // Record success metrics
    metrics.counter(SemanticMetrics.OFFICE_EXTRACTIONS_COUNT).add(1, { status: 'success', format })
    metrics
      .histogram(SemanticMetrics.OFFICE_EXTRACTION_DURATION_MS)
      .record(performance.now() - startTime)

    if (allErrors.length > 0) {
      logger.warn({ errorCount: allErrors.length }, 'Office extraction completed with errors')
    }

    return {
      source,
      format,
      unitCount: attributes.length,
      runCount: runs.length,
      text,
      metadata,
      errors: allErrors,
    }
  })
}

/**
 * Extract text and return detailed information about the extraction process.
 * Useful for debugging or when you need access to intermediate results.
 */
export async function extractFromOfficeDetailed(
  input: OfficeInput,
  options: ExtractAllOptions = {},
): Promise<{
  result: ExtractResult
  attributes: ContentAttributes[]
  runs: ContentRun[]
  extracted: ExtractedUnit[]
  dominantLanguage: string
}> {
  const {
    format: inputFormat,
    timeout,
    parseOptions,
    minCharsForTextRich,
    minCharsForLangDetect,
    maxTextSampleChars,
    ocr,
    ocrLang,
    unitTimeout,
    includeNotes,
    slideRange,
    sheetNames,
    headers,
    unitSeparator = DEFAULT_UNIT_SEPARATOR,
    strict = false,
  } = options

  const allErrors: ContentError[] = []

  // Load
  const { bytes, format, source } = await loadOfficeDocument(input, {
    format: inputFormat,
    timeout,
  })

  // Parse
  const parsed = await parseOfficeBuffer(bytes, {
    newlineDelimiter: '\n\n',
    extractAttachments: true,
    ignoreNotes: !includeNotes,
    ...parseOptions,
  })

  const metadata = extractMetadata(parsed)

  // Analyze
  const attributes = await analyzeDocument(parsed, format, {
    minCharsForTextRich,
    minCharsForLangDetect,
    maxTextSampleChars,
  })

  for (const attr of attributes) {
    if (attr.error) allErrors.push(attr.error)
  }

  // Split
  const runs = splitIntoRuns(attributes)
  const dominantLanguage = getDominantLanguage(runs)

  // Extract
  const extracted = await extractText(parsed, format, attributes, {
    ocr,
    ocrLang,
    unitTimeout,
    includeNotes,
    slideRange,
    sheetNames,
    headers,
  })

  allErrors.push(...getExtractionErrors(extracted))

  // Concatenate
  const text = concatenateExtracted(extracted, unitSeparator)

  if (strict && allErrors.length > 0) {
    throw new OfficeExtractionError(
      `Extraction failed for ${allErrors.length} unit(s)`,
      undefined,
      'extract',
    )
  }

  return {
    result: {
      source,
      format,
      unitCount: attributes.length,
      runCount: runs.length,
      text,
      metadata,
      errors: allErrors,
    },
    attributes,
    runs,
    extracted,
    dominantLanguage,
  }
}

/**
 * Quick text extraction without detailed analysis.
 * Uses OfficeParser's built-in toText() method.
 */
export async function extractTextQuick(
  input: OfficeInput,
  options: Pick<ExtractAllOptions, 'format' | 'timeout' | 'parseOptions'> = {},
): Promise<string> {
  const { format: inputFormat, timeout, parseOptions } = options

  const { bytes } = await loadOfficeDocument(input, { format: inputFormat, timeout })
  const parsed = await parseOfficeBuffer(bytes, parseOptions)

  return parsed.toText()
}
