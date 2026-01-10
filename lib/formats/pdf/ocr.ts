/**
 * Single-page OCR for the PDF plugin.
 * Provides OCR capability for individual pages in the unified pipeline.
 * Uses the shared lib/ocr module for Tesseract.js operations.
 */

import { createCanvas } from '@napi-rs/canvas'

import { recognizeImage } from '../../ocr/index.js'
import { DEFAULT_OCR_RENDER_SCALE, DEFAULT_PAGE_TIMEOUT_MS } from '../../pdf/constants.js'
import type { PDFPageProxy } from '../../pdf/pdfjs.js'
import { asPdfjsCanvasContext } from '../../pdf/pdfjsTypes.js'

// ============================================================================
// Types
// ============================================================================

export interface SinglePageOcrOptions {
  /** OCR language(s): "eng" or "eng+jpn" */
  lang: string

  /** Render scale for the page image */
  renderScale?: number

  /** Directory containing .traineddata.gz files for offline OCR */
  tessdataDir?: string

  /** Per-page timeout in milliseconds */
  pageTimeout?: number
}

export interface SinglePageOcrResult {
  /** Extracted text */
  text: string

  /** OCR confidence score (0-1) */
  confidence: number
}

// ============================================================================
// Single Page OCR
// ============================================================================

/**
 * OCR a single PDF page using Tesseract.js.
 * Renders the page to PNG and uses the shared OCR module.
 */
export async function ocrSinglePage(
  page: PDFPageProxy,
  options: SinglePageOcrOptions,
): Promise<SinglePageOcrResult> {
  const renderScale = options.renderScale ?? DEFAULT_OCR_RENDER_SCALE
  const pageTimeout = options.pageTimeout ?? DEFAULT_PAGE_TIMEOUT_MS

  // Render page to PNG
  const viewport = page.getViewport({ scale: renderScale })
  const width = Math.ceil(viewport.width)
  const height = Math.ceil(viewport.height)

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  // pdfjs-dist v5 requires canvas in RenderParameters
  await page.render({
    canvasContext: asPdfjsCanvasContext(ctx),
    viewport,
    canvas: canvas as unknown as HTMLCanvasElement,
  }).promise

  const png = canvas.toBuffer('image/png')

  // Use shared OCR module
  const result = await recognizeImage(png, {
    lang: options.lang,
    tessdataDir: options.tessdataDir,
    timeout: pageTimeout,
  })

  return {
    text: result.text,
    confidence: result.confidence / 100, // Convert 0-100 to 0-1
  }
}
