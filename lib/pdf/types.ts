// Import and re-export shared types
import type { Lang } from '../common/types.js'

export type { Lang }

export type PageKind = 'born-digital' | 'scanned-image' | 'mixed' | 'empty' | 'unknown'
export type Orientation = 'portrait' | 'landscape'

/**
 * Represents an error that occurred during page processing.
 * Present on PageAttributes when a page fails to analyze.
 */
export interface PageError {
  unitIndex: number
  phase: 'analyze' | 'extract' | 'ocr'
  message: string
  cause?: Error
}

export interface PageAttributes {
  pageIndex: number // 0-based
  kind: PageKind

  rotationDeg: number
  widthPt: number
  heightPt: number
  paperKey: string // normalized (shortSide x longSide, in points)
  orientation: Orientation

  // Signals
  charCount: number
  textSample: string
  imageOpCount: number

  // Coverage (v2)
  maxImageCoverageRatio?: number
  totalImageCoverageRatio?: number
  largeImageCount?: number

  language: Lang

  // Optional - present if page failed to process
  error?: PageError
}

export interface AnalyzePageOptions {
  minCharsForTextPage?: number
  minCharsForLangDetect?: number
  maxTextSampleChars?: number

  // coverage estimation
  minImageCoverageToCount?: number // ignore tiny rasters (logos/icons)
}

export interface SplitRun {
  key: string
  attrs: Pick<PageAttributes, 'kind' | 'paperKey' | 'orientation' | 'language'>
  pageIndices: number[]
  pdfBytes?: Uint8Array
}

export interface SplitPdfOptions extends AnalyzePageOptions {
  includePdfBytes?: boolean
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

export interface ExtractTextOptions {
  kind?: Exclude<PageKind, 'unknown' | 'empty'>

  // OCR
  ocrLang?: string // e.g. "eng" or "eng+jpn"
  ocrRenderScale?: number

  // If kind === "mixed" but digital extraction yields too little text
  mixedFallbackToOcrIfUnderChars?: number

  // Timeout
  /** Per-page timeout in milliseconds. 0 to disable. Default: 60000 (1 minute) */
  pageTimeout?: number

  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

/**
 * Error that occurred during text extraction from a specific page.
 */
export interface ExtractionError {
  unitIndex: number
  phase: 'extract' | 'ocr'
  message: string
}

/**
 * Result from extracting text from a homogeneous PDF.
 * Includes both the extracted text and any errors that occurred.
 */
export interface PdfTextResult {
  text: string
  pageCount: number
  errors: ExtractionError[]
}

/**
 * Progress callback interface for long-running operations.
 *
 * All callbacks are optional. Implement only the ones you need.
 */
export interface ProgressCallbacks {
  /** Called after each page is analyzed */
  onPageAnalyzed?: (pageIndex: number, totalPages: number) => void
  /** Called after each run is extracted */
  onRunExtracted?: (runIndex: number, totalRuns: number) => void
}
