/**
 * PDF-specific types for the unified extraction pipeline.
 * Extends pipeline core types with PDF-specific attributes.
 */

import type { PDFDocumentProxy } from '../../pdf/pdfjs.js'
import type { Orientation, PageKind } from '../../pdf/types.js'
import type { LoadedDocument } from '../../pipeline/plugin.js'
import type { ContentKind, DocumentUnit } from '../../pipeline/types.js'

// ============================================================================
// PDF Unit
// ============================================================================

/**
 * A PDF page as a document unit.
 * Extends DocumentUnit with PDF-specific attributes.
 */
export interface PdfUnit extends DocumentUnit {
  // ----- PDF-specific geometry -----

  /** Page rotation in degrees (0, 90, 180, 270) */
  rotationDeg: number

  /** Page width in points */
  widthPt: number

  /** Page height in points */
  heightPt: number

  /** Normalized paper size key: "612.0x792.0" (US Letter) */
  paperKey: string

  /** Page orientation */
  orientation: Orientation

  // ----- PDF-specific signals -----

  /** Number of image operators on the page */
  imageOpCount: number

  /** Maximum single-image coverage ratio (0-1) */
  maxImageCoverageRatio: number

  /** Total image coverage ratio (0-1) */
  totalImageCoverageRatio: number

  /** Count of large images (above threshold) */
  largeImageCount: number

  // ----- PDF-specific classification -----

  /** Original PDF page kind (before mapping to unified ContentKind) */
  pageKind: PageKind

  // ----- Internal references (not serialized) -----

  /** 1-based page number for PDF.js */
  pageNumber: number
}

// ============================================================================
// PDF Loaded Document
// ============================================================================

/**
 * A loaded PDF document with PDF.js reference.
 */
export interface PdfLoadedDocument extends LoadedDocument {
  /** PDF.js document proxy */
  pdf: PDFDocumentProxy
}

// ============================================================================
// PDF Options
// ============================================================================

/**
 * Options for PDF extraction.
 */
export interface PdfExtractOptions extends Record<string, unknown> {
  /** OCR language(s): "eng" or "eng+jpn" */
  ocrLanguage?: string

  /** OCR render scale (higher = better quality, more memory) */
  ocrRenderScale?: number

  /** If mixed page has fewer chars than this, fall back to OCR */
  mixedFallbackToOcrIfUnderChars?: number

  /** Per-page timeout in ms (default: 60000) */
  pageTimeout?: number

  /** Fetch timeout for URL inputs (ms) */
  fetchTimeout?: number

  /** Headers to include when fetching from URL */
  fetchHeaders?: Record<string, string>

  /**
   * Playwright rendering mode for PDF pages.
   * - 'always': Always use Playwright (best CJK font support)
   * - 'auto': Auto-detect CJK and use Playwright when needed (default)
   * - 'none': Never use Playwright (fastest)
   */
  usePlaywright?: 'always' | 'auto' | 'none'
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Map PDF PageKind to unified ContentKind.
 */
export function mapPageKindToContentKind(pageKind: PageKind): ContentKind {
  switch (pageKind) {
    case 'born-digital':
      return 'text-only'
    case 'scanned-image':
      return 'image-only'
    case 'mixed':
      return 'mixed'
    case 'empty':
      return 'empty'
    default:
      return 'unknown'
  }
}

/**
 * Map unified ContentKind to PDF PageKind for extraction.
 */
export function mapContentKindToPageKind(kind: ContentKind): PageKind {
  switch (kind) {
    case 'text-only':
      return 'born-digital'
    case 'image-only':
      return 'scanned-image'
    case 'mixed':
      return 'mixed'
    case 'empty':
      return 'empty'
    case 'tabular':
      return 'born-digital' // Tables are digital text
    default:
      return 'unknown'
  }
}
