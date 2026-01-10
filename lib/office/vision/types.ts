/**
 * Types for vision mode processing.
 */

import type { ContentAttributes } from '../types.js'

/** Options for vision mode extraction */
export interface VisionOptions {
  /** Enable vision mode */
  enabled: boolean

  /** LLM model specification (provider:model) */
  model: string

  /** Number of parallel conversion workers */
  parallel?: number | boolean

  /** Keep temporary files for debugging */
  keepTemp?: boolean

  /** Custom system prompt for LLM */
  systemPrompt?: string

  /** Maximum images per LLM call */
  maxImagesPerCall?: number

  /** Maximum image dimension (long edge) in pixels. Default: 1024 */
  maxImageDimension?: number

  /** Disable adaptive scaling based on content type. When true, uses fixed maxImageDimension for all pages */
  disableAdaptiveScaling?: boolean
}

/** Default vision options */
export const DEFAULT_VISION_OPTIONS: Required<VisionOptions> = {
  enabled: false,
  model: 'openai:gpt-5-mini',
  parallel: 4,
  keepTemp: false,
  systemPrompt: '',
  maxImagesPerCall: 10,
  maxImageDimension: 1024,
  disableAdaptiveScaling: false,
}

/** An image attachment with context */
export interface ImageAttachment {
  /** Unique identifier */
  id: string

  /** Base64-encoded image data */
  data: string

  /** MIME type */
  mimeType: string

  /** Unit index this image belongs to */
  unitIndex: number

  /** Original filename if available */
  filename?: string
}

/** Content prepared for vision LLM */
export interface VisionContent {
  /** Unit index */
  unitIndex: number

  /** Unit label (e.g., "Slide 1") */
  unitLabel: string

  /** Extracted text (from OfficeParser - accurate) */
  extractedText: string

  /** Rendered image of the unit (from LibreOffice) - for image-only providers */
  renderedImage?: Buffer

  /** PDF bytes (for PDF-capable providers like Anthropic/Google) */
  pdfBytes?: Buffer

  /** Page range within PDF corresponding to this unit */
  pdfPageRange?: { start: number; end: number }

  /** Embedded images from the document */
  embeddedImages: ImageAttachment[]

  /** Content attributes */
  attributes: ContentAttributes
}

/** Result from vision LLM processing */
export interface VisionResult {
  /** Unit index */
  unitIndex: number

  /** LLM-formatted markdown output */
  markdown: string

  /** Token usage (if available) */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** Progress callback for vision processing */
export type VisionProgressCallback = (event: VisionProgressEvent) => void

/** Vision processing progress events */
export type VisionProgressEvent =
  | { type: 'conversion-start'; totalUnits: number }
  | { type: 'conversion-progress'; unitIndex: number; totalUnits: number }
  | { type: 'conversion-done'; totalUnits: number; duration: number }
  | { type: 'llm-start'; totalUnits: number }
  | { type: 'llm-progress'; unitIndex: number; totalUnits: number }
  | { type: 'llm-content'; unitIndex: number; content: string }
  | { type: 'llm-done'; totalUnits: number }
  | { type: 'error'; error: Error; unitIndex?: number }
