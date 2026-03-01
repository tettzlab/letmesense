import fs from 'node:fs/promises'
import { toTesseractLang } from '../common/languages.js'
import { obs } from '../observability/index.js'
import { SemanticAttributes } from '../observability/types.js'
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_MIXED_FALLBACK_CHARS,
  DEFAULT_OCR_RENDER_SCALE,
  DEFAULT_RUN_SEPARATOR,
} from './constants.js'
import { PdfExtractError, PdfExtractionError, PdfLoadError, PdfSplitError } from './errors.js'
import { extractFromHomogeneousPdf } from './extractText.js'
import { Metrics, Spans } from './signals.js'
import { splitIntoRuns } from './splitRuns.js'
import type { ExtractionError, PageKind, ProgressCallbacks } from './types.js'

/** Input can be file path, URL, or raw bytes */
export type PdfInput = string | Uint8Array | Buffer

export interface ExtractAllOptions {
  // OCR settings
  ocrLang?: string // default: 'eng'
  ocrRenderScale?: number // default: 2.5
  mixedFallbackToOcrIfUnderChars?: number // default: 50

  // Analysis options (passed to splitIntoRuns)
  minCharsForTextPage?: number
  minCharsForLangDetect?: number
  minImageCoverageToCount?: number

  // Output control
  includeMetadata?: boolean // default: false
  runSeparator?: string // default: '\n\n===\n\n'

  // Fetch options (for URL inputs)
  fetchTimeout?: number // default: 30000
  fetchHeaders?: Record<string, string>

  // Error handling
  /** If true, throw an error if any page fails to extract. Default: false */
  strictMode?: boolean

  // Performance
  /** If true, extract runs in parallel for better performance. Default: true */
  parallel?: boolean

  // Progress reporting
  /** Callbacks for progress updates during extraction */
  progress?: ProgressCallbacks
}

export interface RunMetadata {
  pageIndices: number[]
  kind: PageKind
  language: string
  charCount: number
  /** Errors that occurred during extraction of this run */
  errors?: ExtractionError[]
}

export interface ExtractAllMetadata {
  source: 'file' | 'url' | 'bytes'
  pageCount: number
  runCount: number
  runs: RunMetadata[]
  /** Total number of pages that failed to extract */
  failedPageCount: number
  /** All errors that occurred during extraction */
  errors: ExtractionError[]
}

export interface ExtractAllResult {
  text: string
  metadata?: ExtractAllMetadata
}

// Re-export for backward compatibility
export { PdfExtractionError } from './errors.js'

type InputType = 'file' | 'url' | 'bytes'

function detectInputType(input: PdfInput): InputType {
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    return 'bytes'
  }
  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return 'url'
    }
    return 'file'
  }
  throw new PdfLoadError('Invalid input type: expected string, Uint8Array, or Buffer')
}

async function loadPdfFromFile(filePath: string): Promise<Uint8Array> {
  try {
    const buffer = await fs.readFile(filePath)
    return new Uint8Array(buffer)
  } catch (err) {
    throw new PdfLoadError(
      `Failed to load PDF from file: ${filePath}`,
      err instanceof Error ? err : undefined,
    )
  }
}

async function loadPdfFromUrl(
  url: string,
  timeout: number,
  headers?: Record<string, string>,
): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'letmesense/1.0',
        ...headers,
      },
    })

    if (!response.ok) {
      throw new PdfLoadError(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type')
    if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream')) {
      throw new PdfLoadError(`Unexpected content-type: ${contentType}`)
    }

    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  } catch (err) {
    if (err instanceof PdfExtractionError) throw err
    throw new PdfLoadError(
      `Failed to fetch PDF from URL: ${url}`,
      err instanceof Error ? err : undefined,
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

function normalizeBytes(input: Uint8Array | Buffer): Uint8Array {
  if (Buffer.isBuffer(input)) {
    return new Uint8Array(input)
  }
  return input
}

/**
 * Extract text from a PDF file, URL, or raw bytes.
 *
 * Automatically splits the PDF into homogeneous "runs" (consecutive pages
 * with identical attributes: kind, paper size, orientation, language),
 * extracts text from each run using the appropriate method (digital or OCR),
 * and concatenates the results.
 */
export async function extractFromPdf(
  input: PdfInput,
  options: ExtractAllOptions = {},
): Promise<ExtractAllResult> {
  const { logger, tracer, metrics } = obs('pdf')

  return tracer.startSpan(Spans.EXTRACT, async (span) => {
    const startTime = performance.now()

    const {
      ocrLang = 'eng',
      ocrRenderScale = DEFAULT_OCR_RENDER_SCALE,
      mixedFallbackToOcrIfUnderChars = DEFAULT_MIXED_FALLBACK_CHARS,
      minCharsForTextPage,
      minCharsForLangDetect,
      minImageCoverageToCount,
      includeMetadata = false,
      runSeparator = DEFAULT_RUN_SEPARATOR,
      fetchTimeout = DEFAULT_FETCH_TIMEOUT_MS,
      fetchHeaders,
      strictMode = false,
      parallel = true,
      progress,
    } = options

    // 1. Detect input type and load PDF bytes
    const inputType = detectInputType(input)
    span.setAttribute(SemanticAttributes.SOURCE, inputType)
    let pdfBytes: Uint8Array

    switch (inputType) {
      case 'file':
        pdfBytes = await loadPdfFromFile(input as string)
        break
      case 'url':
        pdfBytes = await loadPdfFromUrl(input as string, fetchTimeout, fetchHeaders)
        break
      case 'bytes':
        pdfBytes = normalizeBytes(input as Uint8Array | Buffer)
        break
    }

    // 2. Split into homogeneous runs
    let runs: Awaited<ReturnType<typeof splitIntoRuns>>['runs']
    let pages: Awaited<ReturnType<typeof splitIntoRuns>>['pages']

    // Build split options, filtering out undefined values to let defaults apply
    const splitOpts: Parameters<typeof splitIntoRuns>[1] = {
      includePdfBytes: true,
      progress,
    }
    if (minCharsForTextPage !== undefined) splitOpts.minCharsForTextPage = minCharsForTextPage
    if (minCharsForLangDetect !== undefined) splitOpts.minCharsForLangDetect = minCharsForLangDetect
    if (minImageCoverageToCount !== undefined)
      splitOpts.minImageCoverageToCount = minImageCoverageToCount

    try {
      const result = await splitIntoRuns(pdfBytes, splitOpts)
      runs = result.runs
      pages = result.pages
      span.setAttribute(SemanticAttributes.PAGE_COUNT, pages.length)
      span.setAttribute(SemanticAttributes.RUN_COUNT, runs.length)
      logger.info({ source: inputType, pageCount: pages.length }, 'Starting PDF extraction')
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.setError('Failed to split PDF into runs')
      metrics.counter(Metrics.EXTRACTION_COUNT).add(1, { status: 'failure', source: inputType })
      logger.error({ err }, 'PDF extraction failed during split')
      throw new PdfSplitError(
        'Failed to split PDF into runs',
        err instanceof Error ? err : undefined,
      )
    }

    // 3. Extract text from each run
    // Build extraction tasks for non-empty runs
    interface RunTask {
      runIndex: number
      run: (typeof runs)[number]
      extractKind: Exclude<PageKind, 'unknown' | 'empty'>
      runOcrLang: string
    }

    const tasks: RunTask[] = []
    const emptyRunIndices: number[] = []

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]
      if (!run.pdfBytes) continue

      if (run.attrs.kind === 'empty') {
        emptyRunIndices.push(i)
        continue
      }

      const extractKind = run.attrs.kind === 'unknown' ? 'born-digital' : run.attrs.kind
      const runOcrLang =
        run.attrs.language !== 'und' ? toTesseractLang(run.attrs.language, ocrLang) : ocrLang

      tasks.push({ runIndex: i, run, extractKind, runOcrLang })
    }

    // Execute extraction tasks (parallel or sequential based on option)
    type TaskResult = {
      runIndex: number
      run: (typeof runs)[number]
      text: string
      errors: ExtractionError[]
    }

    const executeTask = async (task: RunTask): Promise<TaskResult> => {
      if (!task.run.pdfBytes) {
        throw new Error(`Run ${task.runIndex} missing pdfBytes`)
      }
      const runResult = await extractFromHomogeneousPdf(task.run.pdfBytes, {
        kind: task.extractKind,
        ocrLang: task.runOcrLang,
        ocrRenderScale,
        mixedFallbackToOcrIfUnderChars,
      })

      // Remap page indices from run-local to document-global
      const remappedErrors = runResult.errors.map((e) => ({
        ...e,
        unitIndex: task.run.pageIndices[e.unitIndex],
      }))

      return {
        runIndex: task.runIndex,
        run: task.run,
        text: runResult.text,
        errors: remappedErrors,
      }
    }

    let taskResults: TaskResult[]
    const totalRuns = tasks.length
    let completedRuns = 0

    const executeTaskWithProgress = async (task: RunTask): Promise<TaskResult> => {
      const result = await executeTask(task)
      completedRuns++
      progress?.onRunExtracted?.(completedRuns - 1, totalRuns)
      return result
    }

    if (parallel && tasks.length > 1) {
      // Parallel extraction using Promise.allSettled
      const settled = await Promise.allSettled(tasks.map(executeTaskWithProgress))

      taskResults = []
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i]
        const task = tasks[i]
        if (result.status === 'fulfilled') {
          taskResults.push(result.value)
        } else {
          const error =
            result.reason instanceof Error ? result.reason : new Error(String(result.reason))
          if (strictMode) {
            throw new PdfExtractError(
              `Failed to extract text from run (pages ${task.run.pageIndices
                .map((j) => j + 1)
                .join(', ')})`,
              error,
            )
          }
          // Non-strict: create empty result to maintain run ordering
          taskResults.push({
            runIndex: task.runIndex,
            run: task.run,
            text: '',
            errors: task.run.pageIndices.map((unitIndex) => ({
              unitIndex,
              phase: 'extract' as const,
              message: error.message,
            })),
          })
        }
      }
    } else {
      // Sequential extraction
      taskResults = []
      for (const task of tasks) {
        try {
          taskResults.push(await executeTaskWithProgress(task))
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          if (strictMode) {
            throw new PdfExtractError(
              `Failed to extract text from run (pages ${task.run.pageIndices
                .map((i) => i + 1)
                .join(', ')})`,
              error,
            )
          }
          // Non-strict: create empty result to maintain run ordering
          taskResults.push({
            runIndex: task.runIndex,
            run: task.run,
            text: '',
            errors: task.run.pageIndices.map((unitIndex) => ({
              unitIndex,
              phase: 'extract' as const,
              message: error.message,
            })),
          })
        }
      }
    }

    // Sort results by original run index to maintain order
    taskResults.sort((a, b) => a.runIndex - b.runIndex)

    // Aggregate results
    const textParts: string[] = []
    const runMetadata: RunMetadata[] = []
    const allErrors: ExtractionError[] = []

    // Process results in order, interleaving empty runs
    let taskIdx = 0
    for (let runIdx = 0; runIdx < runs.length; runIdx++) {
      const run = runs[runIdx]
      if (!run.pdfBytes) continue

      if (emptyRunIndices.includes(runIdx)) {
        // Empty run - add metadata only
        if (includeMetadata) {
          runMetadata.push({
            pageIndices: run.pageIndices,
            kind: run.attrs.kind,
            language: run.attrs.language,
            charCount: 0,
          })
        }
        continue
      }

      // Find the task result for this run
      const taskResult = taskResults[taskIdx++]

      allErrors.push(...taskResult.errors)

      // Only add non-empty text to output; count non-whitespace chars for metadata consistency
      const trimmedText = taskResult.text.trim()
      if (trimmedText) {
        textParts.push(taskResult.text)
      }

      if (includeMetadata) {
        runMetadata.push({
          pageIndices: taskResult.run.pageIndices,
          kind: taskResult.run.attrs.kind,
          language: taskResult.run.attrs.language,
          charCount: trimmedText.length,
          errors: taskResult.errors.length > 0 ? taskResult.errors : undefined,
        })
      }
    }

    // 4. Check strict mode
    if (strictMode && allErrors.length > 0) {
      const pageList = allErrors.map((e) => e.unitIndex + 1).join(', ')
      metrics.counter(Metrics.EXTRACTION_COUNT).add(1, { status: 'failure', source: inputType })
      logger.error(
        { errorCount: allErrors.length, pageList },
        'PDF extraction failed in strict mode',
      )
      throw new PdfExtractError(
        `Extraction failed for ${allErrors.length} page(s): ${pageList}`,
        undefined,
      )
    }

    // 5. Concatenate results
    const text = textParts.join(runSeparator)

    // 6. Build result
    const result: ExtractAllResult = { text }

    if (includeMetadata) {
      result.metadata = {
        source: inputType,
        pageCount: pages.length,
        runCount: runs.length,
        runs: runMetadata,
        failedPageCount: allErrors.length,
        errors: allErrors,
      }
    }

    // Record success metrics
    metrics.counter(Metrics.EXTRACTION_COUNT).add(1, { status: 'success', source: inputType })
    metrics.histogram(Metrics.EXTRACTION_DURATION_MS).record(performance.now() - startTime)

    // Record page kind metrics
    for (const run of runs) {
      metrics.counter(Metrics.PAGE_COUNT).add(run.pageIndices.length, { kind: run.attrs.kind })
    }

    if (allErrors.length > 0) {
      logger.warn({ errorCount: allErrors.length }, 'PDF extraction completed with errors')
    }

    return result
  })
}
