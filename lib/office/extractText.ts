/**
 * Text extraction from Office documents.
 * Handles different extraction strategies based on content kind.
 */

import { obs } from '../observability/index.js'
import { SemanticMetrics, SpanNames } from '../observability/types.js'
import { requiresOcr } from './classify.js'
import {
  type ContentNode,
  extractTextFromNodes,
  getContentUnits,
  getSlideNotes,
  getTableData,
  type ParsedDocument,
} from './parser.js'
import type {
  ContentAttributes,
  ContentError,
  ContentRun,
  ExtractOptions,
  OfficeFormat,
} from './types.js'

/** Default extraction options */
export const DEFAULT_EXTRACT_OPTIONS: Required<
  Omit<ExtractOptions, 'kind' | 'slideRange' | 'sheetNames'>
> = {
  ocr: false,
  ocrLang: 'eng',
  unitTimeout: 60000,
  includeNotes: true,
  headers: false,
}

/** Result of extracting text from content units */
export interface ExtractedUnit {
  unitIndex: number
  text: string
  error?: ContentError
}

/**
 * Extract text from a single content unit.
 */
function extractFromUnit(
  node: ContentNode,
  format: OfficeFormat,
  options: Partial<ExtractOptions>,
): string {
  const children = node.children ?? [node]
  let text = extractTextFromNodes(children, '\n\n')

  // Format-specific handling
  switch (format) {
    case 'pptx':
    case 'odp':
      // Include speaker notes if requested
      if (options.includeNotes !== false) {
        const notes = getSlideNotes(node)
        if (notes) {
          text += `\n\n[Speaker Notes]\n${notes}`
        }
      }
      break

    case 'xlsx':
    case 'ods': {
      // For spreadsheets, extract table data
      const tableData = getTableData(node)
      if (tableData.length > 0) {
        // Convert to tab-separated for now (formatters will handle proper formatting)
        text = tableData.map((row) => row.map((cell) => String(cell ?? '')).join('\t')).join('\n')
      }
      break
    }

    case 'docx':
    case 'odt':
      // Standard text extraction is sufficient
      break
  }

  return text.trim()
}

/**
 * Parse a slide range string into an array of 0-based indices.
 *
 * @param range - Range string like "1-5,7,9-12"
 * @param totalSlides - Total number of slides
 * @returns Array of 0-based slide indices
 */
export function parseSlideRange(range: string, totalSlides: number): number[] {
  const indices = new Set<number>()

  const parts = range.split(',').map((p) => p.trim())

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((n) => parseInt(n.trim(), 10))
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= 1 && i <= totalSlides) {
            indices.add(i - 1) // Convert to 0-based
          }
        }
      }
    } else {
      const n = parseInt(part, 10)
      if (!Number.isNaN(n) && n >= 1 && n <= totalSlides) {
        indices.add(n - 1) // Convert to 0-based
      }
    }
  }

  return [...indices].sort((a, b) => a - b)
}

/**
 * Filter sheet names from the available sheets.
 *
 * @param requestedNames - Comma-separated sheet names
 * @param availableSheets - Array of sheet attributes with names
 * @returns Array of indices for matching sheets
 */
export function filterSheetsByName(
  requestedNames: string,
  availableSheets: Array<{ sheetName?: string; unitIndex: number }>,
): number[] {
  const names = requestedNames.split(',').map((n) => n.trim().toLowerCase())

  return availableSheets
    .filter((sheet) => {
      const sheetName = sheet.sheetName?.toLowerCase() ?? ''
      return names.includes(sheetName)
    })
    .map((sheet) => sheet.unitIndex)
}

/**
 * Extract text from a parsed Office document.
 *
 * @param parsed - Parsed document from OfficeParser
 * @param format - Document format
 * @param attributes - Analyzed content attributes
 * @param options - Extraction options
 * @returns Array of extracted text for each unit
 */
export async function extractText(
  parsed: ParsedDocument,
  format: OfficeFormat,
  attributes: ContentAttributes[],
  options: ExtractOptions = {},
): Promise<ExtractedUnit[]> {
  const { tracer, metrics, logger } = obs('office.text')

  return tracer.startSpan(SpanNames.OFFICE_TEXT_EXTRACT, async (span) => {
    const start = performance.now()
    span.setAttribute('format', format)
    span.setAttribute('unitCount', attributes.length)

    const opts = { ...DEFAULT_EXTRACT_OPTIONS, ...options }
    const units = getContentUnits(parsed, format)
    const results: ExtractedUnit[] = []

    // Determine which units to extract
    let targetIndices: number[]

    if (format === 'pptx' && opts.slideRange) {
      targetIndices = parseSlideRange(opts.slideRange, units.length)
    } else if (format === 'xlsx' && opts.sheetNames) {
      const sheetAttrs = attributes
        .filter((a): a is ContentAttributes & { sheetName: string } => 'sheetName' in a)
        .map((a) => ({ sheetName: a.sheetName, unitIndex: a.unitIndex }))
      targetIndices = filterSheetsByName(opts.sheetNames, sheetAttrs)
    } else {
      targetIndices = attributes.map((a) => a.unitIndex)
    }

    for (const unitIndex of targetIndices) {
      const attr = attributes.find((a) => a.unitIndex === unitIndex)
      const node = units[unitIndex]

      if (!node || !attr) {
        results.push({
          unitIndex,
          text: '',
          error: {
            unitIndex,
            phase: 'extract',
            message: `Unit ${unitIndex} not found`,
          },
        })
        continue
      }

      try {
        // Check if this unit requires OCR
        const needsOcr = requiresOcr(attr.kind)

        if (needsOcr && !opts.ocr) {
          // Skip OCR-required units when OCR is disabled
          results.push({
            unitIndex,
            text: `[Image content - OCR required]`,
          })
          continue
        }

        if (needsOcr && opts.ocr) {
          // TODO: Implement OCR for embedded images
          // For now, return placeholder
          results.push({
            unitIndex,
            text: `[Image content - OCR not yet implemented]`,
          })
          continue
        }

        // Extract text directly
        const text = extractFromUnit(node, format, opts)
        results.push({ unitIndex, text })
      } catch (err) {
        results.push({
          unitIndex,
          text: '',
          error: {
            unitIndex,
            phase: 'extract',
            message: err instanceof Error ? err.message : String(err),
            cause: err instanceof Error ? err : undefined,
          },
        })
      }
    }

    const durationMs = performance.now() - start
    const totalChars = results.reduce((acc, r) => acc + r.text.length, 0)
    const errorCount = results.filter((r) => r.error).length

    span.setAttribute('totalChars', totalChars)
    span.setAttribute('errorCount', errorCount)
    span.setAttribute('durationMs', Math.round(durationMs))

    metrics.counter(SemanticMetrics.OFFICE_TEXT_EXTRACT_COUNT).add(1, { format })
    metrics
      .histogram(SemanticMetrics.OFFICE_TEXT_EXTRACT_DURATION_MS)
      .record(durationMs, { format })
    logger.debug({ format, unitCount: results.length, totalChars, durationMs }, 'Text extracted')

    return results
  })
}

/**
 * Extract text from specific runs.
 *
 * @param parsed - Parsed document
 * @param format - Document format
 * @param runs - Content runs to extract
 * @param attributes - All content attributes
 * @param options - Extraction options
 * @returns Map of run key to extracted text
 */
export async function extractTextByRun(
  parsed: ParsedDocument,
  format: OfficeFormat,
  runs: ContentRun[],
  attributes: ContentAttributes[],
  options: ExtractOptions = {},
): Promise<Map<string, ExtractedUnit[]>> {
  const results = new Map<string, ExtractedUnit[]>()
  const units = getContentUnits(parsed, format)
  const opts = { ...DEFAULT_EXTRACT_OPTIONS, ...options }

  for (const run of runs) {
    const runResults: ExtractedUnit[] = []

    for (const unitIndex of run.unitIndices) {
      const attr = attributes.find((a) => a.unitIndex === unitIndex)
      const node = units[unitIndex]

      if (!node || !attr) {
        runResults.push({
          unitIndex,
          text: '',
          error: {
            unitIndex,
            phase: 'extract',
            message: `Unit ${unitIndex} not found`,
          },
        })
        continue
      }

      try {
        const text = extractFromUnit(node, format, opts)
        runResults.push({ unitIndex, text })
      } catch (err) {
        runResults.push({
          unitIndex,
          text: '',
          error: {
            unitIndex,
            phase: 'extract',
            message: err instanceof Error ? err.message : String(err),
          },
        })
      }
    }

    results.set(run.key, runResults)
  }

  return results
}

/**
 * Concatenate extracted units into a single text string.
 *
 * @param extracted - Array of extracted units
 * @param separator - Separator between units
 * @returns Concatenated text
 */
export function concatenateExtracted(
  extracted: ExtractedUnit[],
  separator = '\n\n---\n\n',
): string {
  return extracted
    .filter((e) => e.text.trim().length > 0)
    .map((e) => e.text)
    .join(separator)
}

/**
 * Get all errors from extracted units.
 */
export function getExtractionErrors(extracted: ExtractedUnit[]): ContentError[] {
  return extracted.flatMap((e) => (e.error ? [e.error] : []))
}
