/**
 * Render Office documents to images via LibreOffice → PDF → images.
 */

import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PDFPageProxy } from 'pdfjs-dist'
import { obs, SemanticAttributes } from '../../observability/index.js'
import { throwIfAborted } from '../../pipeline/errors.js'
import { checkLibreOffice, convertToPdf } from '../convert/libreoffice.js'
import { LibreOfficePool } from '../convert/pool.js'
import { OfficeVisionError } from '../errors.js'
import { Metrics, Spans } from '../signals.js'
import type { ContentKind } from '../types.js'
import type { VisionOptions, VisionProgressCallback } from './types.js'

// ============================================================================
// Adaptive Scaling Constants
// ============================================================================

/** Default maximum dimension (long edge) in pixels */
export const DEFAULT_MAX_DIMENSION = 1024

/** Adaptive dimensions by content kind - higher for visually complex content */
export const ADAPTIVE_DIMENSIONS: Record<ContentKind, number> = {
  'text-only': 800, // Lower res - OCR text is primary, image just for context
  mixed: 1024, // Balanced - both text and images matter
  'image-only': 1536, // Higher res - visual details important
  tabular: 1280, // Higher res - tables/charts need clarity
  empty: 600, // Minimal - no meaningful content
  unknown: 1024, // Default to balanced
}

// ============================================================================
// Adaptive Scale Computation
// ============================================================================

/**
 * Compute the scale factor for rendering a PDF page to achieve target dimensions.
 *
 * @param page - PDF page proxy
 * @param kind - Content kind for adaptive scaling (optional)
 * @param options - Vision options with maxImageDimension and disableAdaptiveScaling
 * @returns Scale factor to pass to renderPage
 */
export function computeAdaptiveScale(
  page: PDFPageProxy,
  kind: ContentKind | undefined,
  options: Partial<VisionOptions> = {},
): number {
  // Get the page's natural dimensions at scale 1.0
  const viewport = page.getViewport({ scale: 1.0 })
  const naturalWidth = viewport.width
  const naturalHeight = viewport.height
  const longEdge = Math.max(naturalWidth, naturalHeight)

  // Determine target dimension
  let targetDimension: number
  if (options.disableAdaptiveScaling || !kind) {
    // Use fixed dimension
    targetDimension = options.maxImageDimension ?? DEFAULT_MAX_DIMENSION
  } else {
    // Use adaptive dimension based on content kind
    const adaptiveDimension = ADAPTIVE_DIMENSIONS[kind]
    // Allow user override to cap the maximum
    const maxDimension = options.maxImageDimension ?? DEFAULT_MAX_DIMENSION
    // Use adaptive, but don't exceed user's max if they explicitly set one
    targetDimension = options.maxImageDimension
      ? Math.min(adaptiveDimension, maxDimension)
      : adaptiveDimension
  }

  // Calculate scale to achieve target dimension
  const scale = targetDimension / longEdge

  // Ensure we don't upscale beyond 3x (reasonable max for quality)
  return Math.min(scale, 3.0)
}

/** Result from PDF conversion */
export interface PdfConversionResult {
  /** PDF file contents as Buffer */
  pdfBytes: Buffer
  /** Number of pages in the PDF */
  pageCount: number
  /** Conversion duration in milliseconds */
  duration: number
}

/**
 * Convert an Office document to PDF without rendering to images.
 * Use this for PDF-capable providers (Anthropic, Google) that can process PDF directly.
 *
 * @param inputPath - Path to the Office document
 * @param options - Vision options
 * @param onProgress - Progress callback
 * @returns PDF bytes and page count
 */
export async function convertDocumentToPdf(
  inputPath: string,
  options: Partial<VisionOptions> = {},
  onProgress?: VisionProgressCallback,
): Promise<PdfConversionResult> {
  const { tracer, metrics, logger } = obs('office.vision')

  return tracer.startSpan(Spans.VISION_CONVERT_TO_PDF, async (span) => {
    const start = performance.now()
    span.setAttribute('inputPath', inputPath)

    // Check LibreOffice availability
    const status = checkLibreOffice()
    if (!status.available) {
      span.setAttribute(SemanticAttributes.STATUS, 'error')
      span.setAttribute('error', 'LibreOffice not available')
      throw new OfficeVisionError(`LibreOffice is required for vision mode. ${status.error ?? ''}`)
    }

    const tempDir = join(tmpdir(), `office-pdf-${Date.now()}`)

    try {
      // Convert to PDF
      onProgress?.({ type: 'conversion-start', totalUnits: 1 })

      const result = await convertToPdf(inputPath, { outputDir: tempDir })

      onProgress?.({ type: 'conversion-done', totalUnits: 1, duration: result.duration })

      // Read the PDF and get page count
      const pdfBytes = await readFile(result.outputPath)

      // Get page count from PDF (pdfjs requires Uint8Array)
      const { loadPdfDocumentFromBytes } = await import('../../pdf/pdfjs.js')
      const pdfDoc = await loadPdfDocumentFromBytes(new Uint8Array(pdfBytes))
      const pageCount = pdfDoc.numPages
      await pdfDoc.cleanup()

      const durationMs = performance.now() - start
      span.setAttribute(SemanticAttributes.STATUS, 'success')
      span.setAttribute(SemanticAttributes.PAGE_COUNT, pageCount)
      span.setAttribute('pdfBytes', pdfBytes.length)
      span.setAttribute(SemanticAttributes.DURATION_MS, Math.round(durationMs))

      metrics.counter(Metrics.VISION_RENDER_COUNT).add(1, { status: 'success', mode: 'pdf' })
      metrics.histogram(Metrics.VISION_RENDER_DURATION_MS).record(durationMs, { mode: 'pdf' })
      logger.debug(
        { inputPath, pageCount, pdfBytes: pdfBytes.length, durationMs },
        'Document converted to PDF',
      )

      return {
        pdfBytes,
        pageCount,
        duration: result.duration,
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      span.setAttribute(SemanticAttributes.STATUS, 'error')
      span.recordException(error)
      metrics.counter(Metrics.VISION_RENDER_COUNT).add(1, { status: 'error', mode: 'pdf' })
      onProgress?.({ type: 'error', error })
      throw new OfficeVisionError(`Failed to convert document to PDF: ${error.message}`, error)
    } finally {
      // Cleanup temp files
      if (!options.keepTemp && tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })
}

/**
 * Render an Office document to page images.
 *
 * Flow:
 * 1. Convert Office doc to PDF using LibreOffice
 * 2. Load PDF and render each page to image using existing letmesense
 *
 * @param inputPath - Path to the Office document
 * @param options - Vision options (includes maxImageDimension and disableAdaptiveScaling)
 * @param onProgress - Progress callback
 * @param contentKinds - Optional array of content kinds for adaptive scaling (one per page)
 * @returns Array of page images as Buffers
 */
export async function renderDocumentToImages(
  inputPath: string,
  options: Partial<VisionOptions> = {},
  onProgress?: VisionProgressCallback,
  contentKinds?: ContentKind[],
): Promise<Buffer[]> {
  const { tracer, metrics, logger } = obs('office.vision')

  return tracer.startSpan(Spans.VISION_RENDER_TO_IMAGES, async (span) => {
    const start = performance.now()
    span.setAttribute('inputPath', inputPath)

    // Check LibreOffice availability
    const status = checkLibreOffice()
    if (!status.available) {
      span.setAttribute(SemanticAttributes.STATUS, 'error')
      span.setAttribute('error', 'LibreOffice not available')
      throw new OfficeVisionError(`LibreOffice is required for vision mode. ${status.error ?? ''}`)
    }

    const tempDir = join(tmpdir(), `office-vision-${Date.now()}`)
    let pdfPath: string | undefined

    try {
      // Step 1: Convert to PDF
      onProgress?.({ type: 'conversion-start', totalUnits: 1 })

      const result = await convertToPdf(inputPath, { outputDir: tempDir })
      pdfPath = result.outputPath

      onProgress?.({ type: 'conversion-done', totalUnits: 1, duration: result.duration })

      // Step 2: Render PDF pages to images using existing letmesense module
      // Import dynamically to avoid circular dependencies
      const { loadPdfDocumentFromBytes } = await import('../../pdf/pdfjs.js')
      const { renderPage } = await import('../../pdf/render.js')

      const pdfBytes = await readFile(pdfPath)
      const pdfDoc = await loadPdfDocumentFromBytes(new Uint8Array(pdfBytes))

      const numPages = pdfDoc.numPages
      const images: Buffer[] = []

      span.setAttribute(SemanticAttributes.PAGE_COUNT, numPages)
      onProgress?.({ type: 'llm-start', totalUnits: numPages })

      for (let i = 0; i < numPages; i++) {
        throwIfAborted(options.signal, 'render')

        const page = await pdfDoc.getPage(i + 1)

        // Compute adaptive scale based on content kind
        const kind = contentKinds?.[i]
        const scale = computeAdaptiveScale(page, kind, options)

        const rendered = await renderPage(page, { scale })
        images.push(rendered.buffer)

        onProgress?.({ type: 'llm-progress', unitIndex: i, totalUnits: numPages })
      }

      // Cleanup PDF document
      await pdfDoc.cleanup()

      const durationMs = performance.now() - start
      span.setAttribute(SemanticAttributes.STATUS, 'success')
      span.setAttribute(SemanticAttributes.DURATION_MS, Math.round(durationMs))

      metrics.counter(Metrics.VISION_RENDER_COUNT).add(1, { status: 'success', mode: 'images' })
      metrics.histogram(Metrics.VISION_RENDER_DURATION_MS).record(durationMs, { mode: 'images' })
      logger.debug({ inputPath, pageCount: numPages, durationMs }, 'Document rendered to images')

      return images
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      span.setAttribute(SemanticAttributes.STATUS, 'error')
      span.recordException(error)
      metrics.counter(Metrics.VISION_RENDER_COUNT).add(1, { status: 'error', mode: 'images' })
      onProgress?.({ type: 'error', error })
      throw new OfficeVisionError(`Failed to render document to images: ${error.message}`, error)
    } finally {
      // Cleanup temp files
      if (!options.keepTemp && tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })
}

/**
 * Render multiple Office documents to images in parallel.
 *
 * @param inputPaths - Array of input file paths
 * @param options - Vision options (includes maxImageDimension and disableAdaptiveScaling)
 * @param onProgress - Progress callback
 * @param contentKindsPerDoc - Optional array of content kind arrays (one array per document)
 * @returns Array of arrays of page images
 */
export async function renderManyToImages(
  inputPaths: string[],
  options: Partial<VisionOptions> = {},
  onProgress?: VisionProgressCallback,
  contentKindsPerDoc?: ContentKind[][],
): Promise<Buffer[][]> {
  const poolSize = typeof options.parallel === 'number' ? options.parallel : 4

  const pool = new LibreOfficePool({ poolSize })
  await pool.initialize()

  const tempDir = join(tmpdir(), `office-vision-batch-${Date.now()}`)
  const results: Buffer[][] = []

  try {
    onProgress?.({ type: 'conversion-start', totalUnits: inputPaths.length })

    // Convert all to PDFs in parallel
    const pdfResults = await Promise.all(inputPaths.map((path) => pool.convert(path, tempDir)))

    onProgress?.({ type: 'conversion-done', totalUnits: inputPaths.length, duration: 0 })

    // Render each PDF
    const { loadPdfDocumentFromBytes } = await import('../../pdf/pdfjs.js')
    const { renderPage } = await import('../../pdf/render.js')

    for (let i = 0; i < pdfResults.length; i++) {
      throwIfAborted(options.signal, 'render')

      const pdfPath = pdfResults[i].outputPath
      const pdfBytes = await readFile(pdfPath)
      const pdfDoc = await loadPdfDocumentFromBytes(new Uint8Array(pdfBytes))

      const numPages = pdfDoc.numPages
      const images: Buffer[] = []
      const contentKinds = contentKindsPerDoc?.[i]

      for (let j = 0; j < numPages; j++) {
        throwIfAborted(options.signal, 'render')
        const page = await pdfDoc.getPage(j + 1)

        // Compute adaptive scale based on content kind
        const kind = contentKinds?.[j]
        const scale = computeAdaptiveScale(page, kind, options)

        const rendered = await renderPage(page, { scale })
        images.push(rendered.buffer)
      }

      await pdfDoc.cleanup()
      results.push(images)

      onProgress?.({ type: 'llm-progress', unitIndex: i, totalUnits: inputPaths.length })
    }

    return results
  } finally {
    await pool.shutdown()

    if (!options.keepTemp) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
