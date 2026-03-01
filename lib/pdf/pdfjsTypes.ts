/**
 * Extended type definitions for pdfjs-dist.
 *
 * The official pdfjs-dist types are incomplete for Node.js usage.
 * This module provides type-safe wrappers for undocumented options.
 */

import type { PDFDocumentProxy, PDFPageProxy } from './pdfjs.js'

/**
 * Extended DocumentInitParameters with Node.js-specific options.
 * The official types don't include `disableWorker`.
 */
export interface PdfjsDocumentInitParameters {
  data: Uint8Array
  disableWorker?: boolean
  standardFontDataUrl?: string
  cMapUrl?: string
  cMapPacked?: boolean
}

/**
 * Extended getTextContent options with undocumented properties.
 * The official types don't include `normalizeWhitespace`.
 */
export interface PdfjsTextContentOptions {
  normalizeWhitespace?: boolean
  includeMarkedContent?: boolean
  disableNormalization?: boolean
}

/**
 * Minimal TextContent type for our use case.
 * Only includes the `items` array which is what we use.
 */
export interface PdfjsTextContent {
  items: unknown[]
}

/**
 * Helper to get text content with extended options.
 * Wraps the unsafe cast in one place.
 */
export async function getPageTextContent(
  page: PDFPageProxy,
  opts: PdfjsTextContentOptions = {},
): Promise<PdfjsTextContent> {
  // biome-ignore lint/suspicious/noExplicitAny: pdfjs-dist type definition mismatch
  return page.getTextContent(opts as any)
}

/**
 * Type-safe accessor for PDF.js OPS enum.
 * Some operations are version-dependent or undocumented.
 */
export interface SafeOPS {
  // Always available
  save: number
  restore: number
  transform: number
  paintImageXObject: number
  paintInlineImageXObject: number
  paintImageXObjectRepeat: number
  paintInlineImageXObjectGroup: number
  // Conditionally available (may be undefined in some pdfjs versions)
  setTransform: number | undefined
  paintJpegXObject: number | undefined
}

/**
 * Get type-safe OPS enum values.
 *
 * These are stable constants from pdfjs-dist that don't change between versions.
 * Using static values avoids the need for synchronous module access.
 */
export function getSafeOPS(): SafeOPS {
  // OPS values from pdfjs-dist v5.x - these are stable across versions
  return {
    save: 10,
    restore: 11,
    transform: 12,
    paintImageXObject: 85,
    paintInlineImageXObject: 86,
    paintImageXObjectRepeat: 88,
    paintInlineImageXObjectGroup: 87,
    // These don't exist in pdfjs-dist v5
    setTransform: undefined,
    paintJpegXObject: undefined,
  }
}

/**
 * Type guard for PDF text items.
 * PDF.js returns unknown items that may have a `str` property.
 */
export interface PdfTextItem {
  str: string
}

export function isPdfTextItem(obj: unknown): obj is PdfTextItem {
  return typeof obj === 'object' && obj !== null && 'str' in obj && typeof obj.str === 'string'
}

/**
 * Cast @napi-rs/canvas context to pdfjs-dist's expected type.
 *
 * @napi-rs/canvas returns SKRSContext2D which is mostly compatible with
 * CanvasRenderingContext2D but missing some DOM-specific methods like
 * drawFocusIfNeeded. The cast is safe because pdfjs-dist only uses standard
 * 2D canvas drawing operations that @napi-rs/canvas implements.
 *
 * @param ctx - Canvas 2D context from @napi-rs/canvas or standard DOM canvas
 */
export function asPdfjsCanvasContext(
  ctx:
    | CanvasRenderingContext2D
    | { clearRect: (x: number, y: number, w: number, h: number) => void },
): CanvasRenderingContext2D {
  return ctx as CanvasRenderingContext2D
}

/**
 * Safely extract page view array from PDF page.
 *
 * PDF pages may have missing or malformed view property. This helper
 * provides a default [0, 0, 0, 0] array to prevent crashes.
 *
 * @param page - PDF.js page proxy
 * @returns Page view as [x1, y1, x2, y2] array in points
 */
export function getSafePageView(page: PDFPageProxy): [number, number, number, number] {
  if (Array.isArray(page.view) && page.view.length >= 4) {
    return [page.view[0], page.view[1], page.view[2], page.view[3]]
  }
  return [0, 0, 0, 0]
}

/**
 * Clean up PDF document resources.
 *
 * Properly disposes of PDF.js document to free memory.
 * Safe to call even if cleanup/destroy methods don't exist.
 *
 * @param pdf - PDF.js document proxy to clean up
 */
export async function cleanupPdfDocument(pdf: PDFDocumentProxy): Promise<void> {
  await pdf.cleanup?.()
  await pdf.destroy?.()
}
