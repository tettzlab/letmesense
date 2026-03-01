/**
 * Type definitions for Office document extraction.
 * Mirrors the letmesense type system with format-specific extensions.
 */

// Import and re-export shared types
import type { Lang } from '../common/types.js'
export type { Lang }

// Use canonical ContentKind from pipeline
import type { ContentKind } from '../pipeline/types.js'
export type { ContentKind }

// ============================================================================
// Core Types
// ============================================================================

/** Supported Office document formats */
export type OfficeFormat = 'docx' | 'pptx' | 'xlsx' | 'odt' | 'odp' | 'ods'

// ============================================================================
// Error Types
// ============================================================================

/** Phase where an error occurred during content processing */
export type ContentErrorPhase = 'analyze' | 'extract' | 'ocr'

/**
 * Represents an error during content unit processing.
 * Present on ContentAttributes when a unit fails to analyze.
 */
export interface ContentError {
  unitIndex: number
  phase: ContentErrorPhase
  message: string
  cause?: Error
}

// ============================================================================
// Content Attributes
// ============================================================================

/**
 * Base attributes for any content unit (slide, sheet, section).
 * Analogous to PageAttributes in letmesense.
 */
export interface ContentAttributes {
  /** 0-based index of the content unit */
  unitIndex: number

  /** Human-readable label: "Slide 1", "Sheet: Sales", "Section 3" */
  unitLabel: string

  /** Content classification */
  kind: ContentKind

  /** Number of non-whitespace characters */
  charCount: number

  /** Number of embedded images */
  imageCount: number

  /** First ~400 chars for language detection */
  textSample: string

  /** Detected language (ISO 639-3 or "und") */
  language: Lang

  /** Present if analysis failed for this unit */
  error?: ContentError
}

/**
 * Extended attributes for PowerPoint slides.
 */
export interface SlideAttributes extends ContentAttributes {
  /** 1-based slide number */
  slideNumber: number

  /** Whether slide has speaker notes */
  hasNotes: boolean

  /** Speaker notes text (if hasNotes and extracted) */
  notesText?: string

  /** Layout type if detected */
  layoutType?: string
}

/**
 * Extended attributes for Excel sheets.
 */
export interface SheetAttributes extends ContentAttributes {
  /** Sheet name as shown in Excel */
  sheetName: string

  /** Number of rows with data */
  rowCount: number

  /** Number of columns with data */
  columnCount: number

  /** Whether sheet contains formulas */
  hasFormulas: boolean

  /** 2D array of cell values (if extracted) */
  data?: (string | number | boolean | null)[][]
}

/**
 * Extended attributes for Word document sections.
 */
export interface SectionAttributes extends ContentAttributes {
  /** Heading level if this section starts with a heading (1-6) */
  headingLevel?: number

  /** Heading text if present */
  headingText?: string

  /** Whether section contains tables */
  hasTables: boolean
}

// ============================================================================
// Run Types (Grouped Content)
// ============================================================================

/**
 * A run groups consecutive content units with identical attributes.
 * Analogous to SplitRun in letmesense.
 */
export interface ContentRun {
  /** Unique key: "text-only|eng" */
  key: string

  /** Shared attributes for this run */
  attrs: Pick<ContentAttributes, 'kind' | 'language'>

  /** Indices of content units in this run */
  unitIndices: number[]
}

// ============================================================================
// Options Types
// ============================================================================

/** Options for content analysis */
export interface AnalyzeOptions {
  /** Minimum chars to consider content as text-only (default: 20) */
  minCharsForTextOnly?: number

  /** Minimum chars for language detection (default: 50) */
  minCharsForLangDetect?: number

  /** Maximum chars to keep in textSample (default: 400) */
  maxTextSampleChars?: number
}

/** Options for text extraction */
export interface ExtractOptions {
  /** Override content kind for extraction strategy */
  kind?: Exclude<ContentKind, 'unknown' | 'empty'>

  /** Enable OCR for embedded images */
  ocr?: boolean

  /** OCR language(s): "eng" or "eng+jpn" */
  ocrLang?: string

  /** Per-unit timeout in milliseconds (default: 60000) */
  unitTimeout?: number

  /** For PPTX: include speaker notes */
  includeNotes?: boolean

  /** For PPTX: specific slide range (e.g., "1-5,7,9-12") */
  slides?: string

  /** For XLSX: specific sheet names (comma-separated) */
  sheets?: string

  /** For XLSX: treat first row as headers */
  headers?: boolean
}

/** Output format options */
export type OutputFormat = 'text' | 'markdown' | 'tsv' | 'csv' | 'json'

/** Options for output formatting */
export interface OfficeFormatOptions {
  /** Output format (default: 'text') */
  format?: OutputFormat

  /** For XLSX: override format specifically for spreadsheets */
  xlsxFormat?: Exclude<OutputFormat, 'text'>

  /** Whether to use LLM for markdown formatting */
  llmFormat?: boolean

  /** LLM model specification: "provider:model" */
  model?: string

  /** Send images to LLM (expensive) */
  vision?: boolean
}

// ============================================================================
// Result Types
// ============================================================================

/** Document metadata extracted from Office files */
export interface DocumentMetadata {
  author?: string
  title?: string
  subject?: string
  keywords?: string[]
  created?: Date
  modified?: Date
  lastModifiedBy?: string
  revision?: number
}

/**
 * Result from extracting text from an Office document.
 */
export interface ExtractResult {
  /** Source file path, URL, or identifier */
  source: string

  /** Detected format */
  format: OfficeFormat

  /** Number of content units (slides/sheets/sections) */
  unitCount: number

  /** Number of runs after grouping */
  runCount: number

  /** Extracted text content */
  text: string

  /** Document metadata */
  metadata: DocumentMetadata

  /** Errors encountered during extraction */
  errors: ContentError[]
}

// ============================================================================
// Progress Callbacks
// ============================================================================

/**
 * Progress callback interface for long-running operations.
 */
export interface ProgressCallbacks {
  /** Called after each content unit is analyzed */
  onUnitAnalyzed?: (unitIndex: number, totalUnits: number) => void

  /** Called after each run is extracted */
  onRunExtracted?: (runIndex: number, totalRuns: number) => void
}

// ============================================================================
// Input Types
// ============================================================================

/** Valid input types for Office document loading */
export type OfficeInput = string | Uint8Array | Buffer
