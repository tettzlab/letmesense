import { createCanvas } from '@napi-rs/canvas'
import type { PageViewport } from 'pdfjs-dist'
import { obs } from '../observability/index.js'
import { SemanticAttributes } from '../observability/types.js'
import {
  createOcrWorker,
  defaultTessdataDir,
  shouldUseOffline,
  terminateWorker,
} from '../ocr/index.js'
import {
  DEFAULT_OCR_RENDER_SCALE,
  DEFAULT_PAGE_SEPARATOR,
  DEFAULT_PAGE_TIMEOUT_MS,
  withTimeout,
} from './constants.js'
import type { PDFDocumentProxy, PDFPageProxy } from './pdfjs.js'
import { asPdfjsCanvasContext } from './pdfjsTypes.js'
import { Metrics, Spans } from './signals.js'
import type { ExtractionError } from './types.js'

/**
 * Result from OCR processing of a PDF document.
 */
export interface OcrResult {
  text: string
  pageCount: number
  errors: ExtractionError[]
}

export interface OcrOptions {
  lang: string // e.g. "eng" or "eng+jpn"
  renderScale?: number
  tessdataDir?: string
  detectOrientation?: boolean
  /** Per-page timeout in milliseconds. 0 to disable. Default: 60000 (1 minute) */
  pageTimeout?: number
}

export async function ocrPdfJsDocument(
  pdf: PDFDocumentProxy,
  options: OcrOptions,
): Promise<OcrResult> {
  const { tracer, metrics } = obs('pdf')

  return tracer.startSpan(Spans.OCR, async (span) => {
    const renderScale = options.renderScale ?? DEFAULT_OCR_RENDER_SCALE
    const tessdataDir = options.tessdataDir ?? defaultTessdataDir()
    const pageTimeout = options.pageTimeout ?? DEFAULT_PAGE_TIMEOUT_MS

    span.setAttribute('lang', options.lang)
    span.setAttribute(SemanticAttributes.PAGE_COUNT, pdf.numPages)

    const useOffline = shouldUseOffline(tessdataDir, options.lang)
    span.setAttribute('useOffline', useOffline)

    const worker = await createOcrWorker({
      lang: options.lang,
      tessdataDir,
    })

    try {
      const out: string[] = []
      const errors: ExtractionError[] = []

      // Pre-scan to find max dimensions and cache page/viewport for reuse
      // This eliminates N-1 canvas allocations (~3MB each at 2.5x scale)
      // and avoids double getPage() calls (was calling getPage twice per page)
      let maxWidth = 0
      let maxHeight = 0
      const pageInfo: Array<{ page: PDFPageProxy; viewport: PageViewport }> = []
      for (let i = 0; i < pdf.numPages; i++) {
        const page = await pdf.getPage(i + 1)
        const viewport = page.getViewport({ scale: renderScale })
        pageInfo.push({ page, viewport })
        maxWidth = Math.max(maxWidth, Math.ceil(viewport.width))
        maxHeight = Math.max(maxHeight, Math.ceil(viewport.height))
      }

      // Create single reusable canvas at max dimensions
      const canvas = createCanvas(maxWidth, maxHeight)
      const ctx = canvas.getContext('2d')

      for (let i = 0; i < pageInfo.length; i++) {
        try {
          const { page, viewport } = pageInfo[i]

          // Process page with timeout
          const processPage = async () => {
            // Clear canvas before rendering (reuse instead of allocating new)
            ctx.clearRect(0, 0, maxWidth, maxHeight)

            // pdfjs-dist v5 requires canvas in RenderParameters
            await page.render({
              canvasContext: asPdfjsCanvasContext(ctx),
              viewport,
              canvas: canvas as unknown as HTMLCanvasElement,
            }).promise
            const png = canvas.toBuffer('image/png')

            if (options.detectOrientation) {
              await worker.detect(png)
            }

            const { data } = await worker.recognize(png)
            return (data?.text ?? '').trim()
          }

          const text = await withTimeout(processPage(), pageTimeout, `OCR page ${i + 1} timed out`)
          out.push(text)
          metrics.counter(Metrics.OCR_PAGE_COUNT).add(1, { status: 'success' })
        } catch (err) {
          // Graceful degradation: empty string for failed page, track error
          out.push('')
          errors.push({
            unitIndex: i,
            phase: 'ocr',
            message: err instanceof Error ? err.message : String(err),
          })
          metrics.counter(Metrics.OCR_PAGE_COUNT).add(1, { status: 'failure' })
        }
      }

      span.setAttribute(SemanticAttributes.ERROR_COUNT, errors.length)

      return {
        text: out.join(DEFAULT_PAGE_SEPARATOR).trim(),
        pageCount: pageInfo.length,
        errors,
      }
    } finally {
      await terminateWorker(worker)
    }
  })
}
