/**
 * PDF page rendering utilities
 *
 * Provides functions to render PDF pages to images (PNG/JPEG).
 * Used by OCR and vision LLM features.
 */

import { type Canvas, createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { obs } from '../observability/index.js'
import { SemanticAttributes } from '../observability/types.js'
import { throwIfAborted } from '../pipeline/errors.js'
import { DEFAULT_OCR_RENDER_SCALE } from './constants.js'
import type { PDFDocumentProxy, PDFPageProxy } from './pdfjs.js'
import { asPdfjsCanvasContext } from './pdfjsTypes.js'
import { Metrics, Spans } from './signals.js'

/** Image format for rendered pages */
export type ImageFormat = 'png' | 'jpeg'

/** Options for rendering a page */
export interface RenderOptions {
  /** Render scale (higher = better quality, more memory) */
  scale?: number
  /** Image format */
  format?: ImageFormat
  /** JPEG quality (0-100), only used for jpeg format */
  quality?: number
}

/** Result of rendering a page */
export interface RenderedPage {
  /** Image buffer (PNG or JPEG) */
  buffer: Buffer
  /** Width in pixels */
  width: number
  /** Height in pixels */
  height: number
  /** Image format */
  format: ImageFormat
  /** Base64 data URI for LLM APIs */
  dataUri: string
}

/**
 * Render a single PDF page to an image
 */
export async function renderPage(
  page: PDFPageProxy,
  options?: RenderOptions,
): Promise<RenderedPage> {
  const { tracer, metrics } = obs('pdf.render')

  return tracer.startSpan(Spans.RENDER_PAGE, async (span) => {
    const scale = options?.scale ?? DEFAULT_OCR_RENDER_SCALE
    const format = options?.format ?? 'png'

    span.setAttribute(SemanticAttributes.SCALE, scale)
    span.setAttribute(SemanticAttributes.FORMAT, format)

    const viewport = page.getViewport({ scale })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)

    span.setAttribute(SemanticAttributes.WIDTH, width)
    span.setAttribute(SemanticAttributes.HEIGHT, height)

    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')

    // pdfjs-dist v5 requires canvas in RenderParameters
    await page.render({
      canvasContext: asPdfjsCanvasContext(ctx),
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise

    const buffer =
      format === 'jpeg'
        ? canvas.toBuffer('image/jpeg', options?.quality ?? 85)
        : canvas.toBuffer('image/png')

    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png'
    const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`

    span.setAttribute('bufferSize', buffer.length)
    metrics.counter(Metrics.PAGE_RENDER_COUNT).add(1, { format })
    metrics.histogram(Metrics.RENDER_BYTES).record(buffer.length, { format })

    return { buffer, width, height, format, dataUri }
  })
}

/**
 * Context for rendering multiple pages efficiently (reuses canvas)
 */
export class PageRenderer {
  private canvas: Canvas | null = null
  private ctx: SKRSContext2D | null = null
  private maxWidth = 0
  private maxHeight = 0

  /**
   * Initialize renderer with max dimensions from all pages
   * Call this before renderPage() for memory efficiency
   */
  async init(pdf: PDFDocumentProxy, scale: number = DEFAULT_OCR_RENDER_SCALE): Promise<void> {
    // Pre-scan to find max dimensions
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1)
      const viewport = page.getViewport({ scale })
      this.maxWidth = Math.max(this.maxWidth, Math.ceil(viewport.width))
      this.maxHeight = Math.max(this.maxHeight, Math.ceil(viewport.height))
    }

    // Create single reusable canvas at max dimensions
    this.canvas = createCanvas(this.maxWidth, this.maxHeight)
    this.ctx = this.canvas.getContext('2d')
  }

  /**
   * Render a page using the pre-allocated canvas
   */
  async renderPage(page: PDFPageProxy, options?: RenderOptions): Promise<RenderedPage> {
    if (!this.canvas || !this.ctx) {
      // Fallback to non-optimized rendering
      return renderPage(page, options)
    }

    const scale = options?.scale ?? DEFAULT_OCR_RENDER_SCALE
    const format = options?.format ?? 'png'

    const viewport = page.getViewport({ scale })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)

    // Clear canvas before rendering
    this.ctx.clearRect(0, 0, this.maxWidth, this.maxHeight)

    // pdfjs-dist v5 requires canvas in RenderParameters
    await page.render({
      canvasContext: asPdfjsCanvasContext(this.ctx),
      viewport,
      canvas: this.canvas as unknown as HTMLCanvasElement,
    }).promise

    // Get image data (only the rendered area, not full canvas)
    // Note: toBuffer gets full canvas, but that's fine for our use case
    const buffer =
      format === 'jpeg'
        ? this.canvas.toBuffer('image/jpeg', options?.quality ?? 85)
        : this.canvas.toBuffer('image/png')

    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png'
    const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`

    return { buffer, width, height, format, dataUri }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.canvas = null
    this.ctx = null
  }
}

/** Options for rendering all pages */
export interface RenderAllOptions extends RenderOptions {
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

/**
 * Render all pages of a PDF document
 */
export async function renderAllPages(
  pdf: PDFDocumentProxy,
  options?: RenderAllOptions,
): Promise<RenderedPage[]> {
  const { tracer, metrics, logger } = obs('pdf.render')

  return tracer.startSpan(Spans.RENDER_ALL_PAGES, async (span) => {
    span.setAttribute('numPages', pdf.numPages)
    span.setAttribute(SemanticAttributes.SCALE, options?.scale ?? DEFAULT_OCR_RENDER_SCALE)

    const renderer = new PageRenderer()
    const scale = options?.scale ?? DEFAULT_OCR_RENDER_SCALE

    try {
      await renderer.init(pdf, scale)

      const pages: RenderedPage[] = []
      for (let i = 0; i < pdf.numPages; i++) {
        throwIfAborted(options?.signal, 'render')
        const page = await pdf.getPage(i + 1)
        const rendered = await renderer.renderPage(page, options)
        pages.push(rendered)
      }

      const totalBytes = pages.reduce((sum, p) => sum + p.buffer.length, 0)
      span.setAttribute('totalBytes', totalBytes)
      metrics.histogram(Metrics.RENDER_ALL_BYTES).record(totalBytes)
      logger.debug({ numPages: pdf.numPages, totalBytes }, 'All pages rendered')

      return pages
    } finally {
      renderer.dispose()
    }
  })
}
