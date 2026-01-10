/**
 * Office-specific types for the unified extraction pipeline.
 * Extends pipeline core types with Office-specific attributes.
 */

import type { ParsedDocument } from '../../office/parser.js'
import type { ContentKind as OfficeContentKind, OfficeFormat } from '../../office/types.js'
import type { PDFDocumentProxy } from '../../pdf/pdfjs.js'
import type { LoadedDocument } from '../../pipeline/plugin.js'
import type { ContentKind, DocumentUnit } from '../../pipeline/types.js'

// ============================================================================
// Office Unit
// ============================================================================

/**
 * An Office content unit (slide/sheet/section) as a document unit.
 * Extends DocumentUnit with Office-specific attributes.
 */
export interface OfficeUnit extends DocumentUnit {
  /** Human-readable unit label: "Slide 1", "Sheet: Sales", "Section 3" */
  unitLabel: string

  /** Number of embedded images */
  imageCount: number

  /** Original Office content kind (before mapping to unified ContentKind) */
  officeKind: OfficeContentKind

  /** For PPTX: 1-based slide number */
  slideNumber?: number

  /** For PPTX: whether slide has speaker notes */
  hasNotes?: boolean

  /** For PPTX: speaker notes text */
  notesText?: string

  /** For XLSX: sheet name */
  sheetName?: string

  /** For XLSX: number of rows with data */
  rowCount?: number

  /** For XLSX: number of columns with data */
  columnCount?: number

  /** For DOCX: heading level if section starts with heading */
  headingLevel?: number

  /** For DOCX: heading text */
  headingText?: string

  /** For DOCX: whether section contains tables */
  hasTables?: boolean
}

// ============================================================================
// Office Loaded Document
// ============================================================================

/**
 * A loaded Office document with parsed content.
 */
export interface OfficeLoadedDocument extends LoadedDocument {
  /** Detected Office format */
  officeFormat: OfficeFormat

  /** Parsed document from OfficeParser */
  parsed: ParsedDocument

  /** Original source (path, URL, or 'buffer') */
  source: string

  /** File path for vision mode (if loaded from file, or temp file for URL/buffer) */
  filePath?: string

  /** Cached PDF document for vision rendering (lazily converted) */
  cachedPdf?: {
    doc: PDFDocumentProxy
    pageCount: number
  }

  /** Temp file path to clean up (for URL/buffer inputs) */
  tempFilePath?: string
}

// ============================================================================
// Office Options
// ============================================================================

/**
 * Options for Office extraction.
 */
export interface OfficeExtractOptions extends Record<string, unknown> {
  /** Override content kind for extraction strategy */
  kind?: Exclude<OfficeContentKind, 'unknown' | 'empty'>

  /** Enable OCR for embedded images */
  ocr?: boolean

  /** OCR language(s): "eng" or "eng+jpn" */
  ocrLanguage?: string

  /** Per-unit timeout in milliseconds (default: 60000) */
  unitTimeout?: number

  /** For PPTX: include speaker notes */
  includeNotes?: boolean

  /** For PPTX: specific slide range (e.g., "1-5,7,9-12") */
  slideRange?: string

  /** For XLSX: specific sheet names (comma-separated) */
  sheetNames?: string

  /** For XLSX: treat first row as headers */
  headers?: boolean

  /** Fetch timeout for URL inputs (ms) */
  fetchTimeout?: number

  /** Headers to include when fetching from URL */
  fetchHeaders?: Record<string, string>
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Map Office ContentKind to unified pipeline ContentKind.
 */
export function mapOfficeKindToContentKind(officeKind: OfficeContentKind): ContentKind {
  switch (officeKind) {
    case 'text-rich':
      return 'text-only'
    case 'image-heavy':
      return 'image-only'
    case 'mixed':
      return 'mixed'
    case 'table':
      return 'tabular'
    case 'empty':
      return 'empty'
    default:
      return 'unknown'
  }
}

/**
 * Map unified ContentKind to Office ContentKind for extraction.
 */
export function mapContentKindToOfficeKind(kind: ContentKind): OfficeContentKind {
  switch (kind) {
    case 'text-only':
      return 'text-rich'
    case 'image-only':
      return 'image-heavy'
    case 'mixed':
      return 'mixed'
    case 'tabular':
      return 'table'
    case 'empty':
      return 'empty'
    default:
      return 'unknown'
  }
}
