/**
 * Core types for the unified extraction pipeline.
 * Format-agnostic abstractions that plugins implement.
 */

import type { PromptPreset } from '../ai/prompts.js'
import type { JournalCallback } from '../ai/types.js'
import type { Lang } from '../common/types.js'

export type { PromptPreset }

export type { Lang }

// ============================================================================
// Content Classification
// ============================================================================

/**
 * Unified content classification across all formats.
 * Maps from format-specific kinds (e.g., PDF's 'born-digital' → 'text-only').
 */
export type ContentKind =
  | 'text-only' // Pure text content (PDF: born-digital)
  | 'image-only' // Scanned/image content (PDF: scanned-image)
  | 'mixed' // Significant text and images
  | 'tabular' // Tables/charts requiring special handling
  | 'empty' // No meaningful content
  | 'unknown' // Analysis failed or indeterminate

// ============================================================================
// Document Format Identification
// ============================================================================

/** Supported document formats */
export type FormatId = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'odt' | 'odp' | 'ods' | 'image'

// ============================================================================
// Document Units
// ============================================================================

/**
 * Base interface for a document unit (page, slide, sheet, section).
 * Plugins extend this with format-specific attributes.
 */
export interface DocumentUnit {
  /** 0-based index of this unit */
  index: number

  /** Human-readable label: "Page 1", "Slide 2", "Sheet: Sales" */
  label: string

  /** Content classification */
  kind: ContentKind

  /** Number of non-whitespace characters */
  charCount: number

  /** Detected language (ISO 639-3 or "und") */
  language: Lang

  /** First ~400 chars for language detection and preview */
  textSample: string

  /** Error if analysis failed for this unit */
  error?: UnitError
}

/**
 * Error that occurred during unit processing.
 * Non-fatal: allows pipeline to continue with remaining units.
 */
export interface UnitError {
  unitIndex: number
  phase: 'analyze' | 'extract' | 'render' | 'ocr' | 'vision'
  message: string
  cause?: Error
}

// ============================================================================
// Document Runs
// ============================================================================

/**
 * A run groups consecutive document units with identical processing characteristics.
 * Enables batch processing (e.g., OCR all scanned pages together).
 *
 * @template U - Unit type (extends DocumentUnit)
 */
export interface DocumentRun<U extends DocumentUnit = DocumentUnit> {
  /** Unique key for this run: "text-only|eng" or format-specific */
  key: string

  /** Content kind shared by all units in this run */
  kind: ContentKind

  /** Language shared by all units in this run */
  language: Lang

  /** Indices of units in this run (consecutive, in order) */
  unitIndices: number[]

  /** Units in this run (populated if requested) */
  units?: U[]
}

// ============================================================================
// Extraction Provenance
// ============================================================================

/** How text was extracted - affects reliability */
export type ExtractionMethod = 'digital' | 'ocr' | 'vision' | 'hybrid'

/** Reliability classification for extraction provenance */
export type ExtractionReliability = 'exact' | 'high' | 'medium' | 'low'

/**
 * Provenance information for extracted text.
 * Tracks how text was obtained for downstream processing decisions.
 */
export interface ExtractionProvenance {
  /** Extraction method used */
  method: ExtractionMethod

  /** Reliability of the extraction */
  reliability: ExtractionReliability

  /** Confidence score (0-1), if available */
  confidence?: number

  /** OCR engine used, if applicable */
  ocrEngine?: string

  /** Vision model used, if applicable */
  visionModel?: string
}

// ============================================================================
// Extraction Results
// ============================================================================

/**
 * Result from extracting text from a single unit.
 */
export interface UnitExtractionResult {
  /** Extracted text content */
  text: string

  /** Character count of extracted text */
  charCount: number

  /** How the text was extracted */
  extraction: ExtractionProvenance
}

/**
 * Result from extracting text from a document.
 */
export interface ExtractionResult {
  /** Concatenated extracted text */
  text: string

  /** Source identifier (file path, URL, or descriptor) */
  source: string

  /** Detected format */
  format: FormatId

  /** Number of units processed */
  unitCount: number

  /** Number of runs after grouping */
  runCount: number

  /** Non-fatal errors encountered during extraction */
  errors: UnitError[]

  /** Optional metadata from document */
  metadata?: Record<string, unknown>
}

/**
 * A single extracted unit with its text and metadata.
 * Used for per-unit LLM processing.
 */
export interface ExtractedUnit {
  /** 0-based index of this unit */
  index: number

  /** Human-readable label: "Page 1", "Slide 2", "Sheet: Sales" */
  label: string

  /** Extracted text content */
  text: string

  /** Content classification */
  kind: ContentKind

  /** Detected language (ISO 639-3 or "und") */
  language: Lang
}

/**
 * Result from extracting text with individual units preserved.
 * Used when per-unit processing is needed (e.g., LLM formatting).
 */
export interface ExtractUnitsResult {
  /** Individual extracted units with their text */
  units: ExtractedUnit[]

  /** Standard extraction result (with concatenated text) */
  result: ExtractionResult
}

// ============================================================================
// Document Source
// ============================================================================

/** Source type for document loading */
export type SourceType = 'file' | 'url' | 'buffer' | 'stdin'

/**
 * Describes the source of a document for error messages and logging.
 */
export interface DocumentSource {
  /** Type of source */
  type: SourceType

  /** Path or URL (if applicable) */
  path?: string

  /** Detected or specified format */
  format: FormatId
}

// ============================================================================
// Options
// ============================================================================

/**
 * Options for document extraction.
 */
export interface ExtractAllOptions {
  /** Override format detection */
  format?: FormatId

  /** Enable parallel extraction (default: true) */
  parallel?: boolean

  /** Separator between units (default: '\n\n') */
  separator?: string

  /** Include document metadata in result */
  includeMetadata?: boolean

  /** Progress callback */
  onProgress?: import('./progress.js').ProgressCallback

  /** Throw on first error instead of collecting (default: false) */
  strict?: boolean

  /** OCR language(s): "eng" or "eng+jpn" */
  ocrLanguage?: string

  /** AbortSignal for cancellation support */
  signal?: AbortSignal

  /** Allow format-specific options to pass through to plugins */
  [key: string]: unknown
}

/**
 * Options for vision-based extraction (LLM).
 */
export interface VisionExtractOptions extends ExtractAllOptions {
  /** LLM model to use: "provider:model" */
  model: string

  /** Custom system prompt for the LLM (overrides promptPreset) */
  systemPrompt?: string

  /**
   * Use a built-in prompt preset. Ignored if systemPrompt is provided.
   *
   * Prompts are automatically composed from two dimensions:
   * 1. Text Reliability: digital, ocr-high, ocr-medium, ocr-low, none
   * 2. Document Type: pdf, pptx, xlsx, docx, image
   *
   * The system auto-selects based on:
   * - File extension → Document type (e.g., .pptx → pptx guidelines)
   * - Extraction method + OCR confidence → Text reliability instructions
   *
   * Use this option to override auto-selection with a specific preset.
   */
  promptPreset?: PromptPreset

  /** Render scale for page images (default: 2) */
  renderScale?: number

  /**
   * Playwright rendering mode for PDF pages.
   * - 'always': Always use Playwright (best CJK font support)
   * - 'auto': Auto-detect CJK and use Playwright when needed (default)
   * - 'none': Never use Playwright (fastest)
   */
  usePlaywright?: 'always' | 'auto' | 'none'

  /** Experiment name for journaling */
  experiment?: string

  /** Journal callback for logging LLM calls */
  onJournal?: JournalCallback
}

// ============================================================================
// Vision Streaming
// ============================================================================

/**
 * Chunk types emitted during vision extraction streaming.
 */
export type VisionChunk =
  | { type: 'unit-start'; unitIndex: number; label: string }
  | { type: 'content'; content: string; unitIndex: number }
  | { type: 'unit-done'; unitIndex: number; charCount: number }
  | { type: 'error'; error: UnitError }

// ============================================================================
// Document Input
// ============================================================================

/** Valid input types for document loading */
export type DocumentInput = string | Uint8Array | Buffer | URL
