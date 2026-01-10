/**
 * Prompt template utilities and legacy constants.
 *
 * For the new prompt composition framework, see lib/pipeline/prompts.ts
 */

import { obs } from '../observability/index.js'
// Import for internal use
import {
  buildPromptForExtraction as _buildPromptForExtraction,
  composePrompt as _composePrompt,
  determineDocumentType as _determineDocumentType,
} from '../pipeline/prompts.js'
import type { PageContext } from './types.js'

// Re-export composition framework from pipeline for backwards compatibility
export {
  buildPromptForExtraction,
  composePrompt,
  type DocumentType,
  determineDocumentType,
  determineTextReliability,
  type ExtractionMode,
  type PromptOptions,
  // Pre-built prompts
  TEXT_ONLY_DIGITAL_PDF,
  TEXT_ONLY_OCR_HIGH_PDF,
  TEXT_ONLY_OCR_LOW_PDF,
  TEXT_ONLY_OCR_MEDIUM_PDF,
  type TextReliability,
  VISION_DIGITAL_PDF,
  VISION_DOCX,
  VISION_IMAGE,
  VISION_NO_TEXT_PDF,
  VISION_OCR_HIGH_PDF,
  VISION_OCR_LOW_PDF,
  VISION_OCR_MEDIUM_PDF,
  VISION_PPTX,
  VISION_XLSX,
} from '../pipeline/prompts.js'

// ============================================================================
// Legacy Prompt Constants
// ============================================================================

/** Import pre-built prompts for local use and legacy aliases */
import {
  VISION_DIGITAL_PDF as DEFAULT_VISION_PROMPT_INTERNAL,
  VISION_DOCX as DOCX_PROMPT_INTERNAL,
  VISION_NO_TEXT_PDF as IMAGE_ONLY_PROMPT_INTERNAL,
  VISION_IMAGE as IMAGE_VISION_PROMPT_INTERNAL,
  VISION_OCR_HIGH_PDF as OCR_HIGH_CONFIDENCE_PROMPT_INTERNAL,
  VISION_OCR_LOW_PDF as OCR_LOW_CONFIDENCE_PROMPT_INTERNAL,
  VISION_OCR_MEDIUM_PDF as OCR_MEDIUM_CONFIDENCE_PROMPT_INTERNAL,
  VISION_PPTX as PPTX_PROMPT_INTERNAL,
  TEXT_ONLY_OCR_HIGH_PDF as TEXT_ONLY_OCR_HIGH_PROMPT_INTERNAL,
  TEXT_ONLY_OCR_LOW_PDF as TEXT_ONLY_OCR_LOW_PROMPT_INTERNAL,
  TEXT_ONLY_OCR_MEDIUM_PDF as TEXT_ONLY_OCR_MEDIUM_PROMPT_INTERNAL,
  TEXT_ONLY_DIGITAL_PDF as TEXT_ONLY_PROMPT_INTERNAL,
  VISION_XLSX as XLSX_PROMPT_INTERNAL,
} from '../pipeline/prompts.js'

// Legacy aliases - now generated from composition framework
/**
 * Default text-only formatting prompt.
 * Generated from: mode='text-only', textReliability='digital', documentType='pdf'
 */
export const DEFAULT_TEXT_PROMPT = TEXT_ONLY_PROMPT_INTERNAL
export const DEFAULT_VISION_PROMPT = DEFAULT_VISION_PROMPT_INTERNAL
export const OCR_HIGH_CONFIDENCE_PROMPT = OCR_HIGH_CONFIDENCE_PROMPT_INTERNAL
export const OCR_MEDIUM_CONFIDENCE_PROMPT = OCR_MEDIUM_CONFIDENCE_PROMPT_INTERNAL
export const OCR_LOW_CONFIDENCE_PROMPT = OCR_LOW_CONFIDENCE_PROMPT_INTERNAL
export const IMAGE_ONLY_PROMPT = IMAGE_ONLY_PROMPT_INTERNAL
export const IMAGE_VISION_PROMPT = IMAGE_VISION_PROMPT_INTERNAL
export const PPTX_PROMPT = PPTX_PROMPT_INTERNAL
export const XLSX_PROMPT = XLSX_PROMPT_INTERNAL
export const DOCX_PROMPT = DOCX_PROMPT_INTERNAL
export const TEXT_ONLY_PROMPT = TEXT_ONLY_PROMPT_INTERNAL
export const TEXT_ONLY_OCR_HIGH_PROMPT = TEXT_ONLY_OCR_HIGH_PROMPT_INTERNAL
export const TEXT_ONLY_OCR_MEDIUM_PROMPT = TEXT_ONLY_OCR_MEDIUM_PROMPT_INTERNAL
export const TEXT_ONLY_OCR_LOW_PROMPT = TEXT_ONLY_OCR_LOW_PROMPT_INTERNAL

/** Prompt with page continuity context */
export const CONTINUITY_PROMPT_PREFIX = `Context: You are formatting page {page} of {totalPages}.
Previous page ended with: "{previousTail}"

Maintain continuity - if the previous context suggests a list, section, or sentence continues, preserve that continuity in your formatting.

`

/** All built-in prompts */
export const PROMPTS = {
  // Legacy text-only prompt
  DEFAULT_TEXT: DEFAULT_TEXT_PROMPT,
  // Vision mode prompts
  DEFAULT_VISION: DEFAULT_VISION_PROMPT,
  OCR_HIGH_CONFIDENCE: OCR_HIGH_CONFIDENCE_PROMPT,
  OCR_MEDIUM_CONFIDENCE: OCR_MEDIUM_CONFIDENCE_PROMPT,
  OCR_LOW_CONFIDENCE: OCR_LOW_CONFIDENCE_PROMPT,
  IMAGE_ONLY: IMAGE_ONLY_PROMPT,
  IMAGE_VISION: IMAGE_VISION_PROMPT,
  PPTX: PPTX_PROMPT,
  XLSX: XLSX_PROMPT,
  DOCX: DOCX_PROMPT,
  // Text-only mode prompts (for --llm without vision)
  TEXT_ONLY: TEXT_ONLY_PROMPT,
  TEXT_ONLY_OCR_HIGH: TEXT_ONLY_OCR_HIGH_PROMPT,
  TEXT_ONLY_OCR_MEDIUM: TEXT_ONLY_OCR_MEDIUM_PROMPT,
  TEXT_ONLY_OCR_LOW: TEXT_ONLY_OCR_LOW_PROMPT,
} as const

export type PromptPreset = keyof typeof PROMPTS

// ============================================================================
// Legacy Functions
// ============================================================================

/**
 * @deprecated Use determineTextReliability() instead
 */
export function selectOcrPrompt(confidence: number | undefined): PromptPreset {
  if (confidence === undefined) {
    return 'DEFAULT_VISION'
  }
  if (confidence >= 0.95) {
    return 'OCR_HIGH_CONFIDENCE'
  }
  if (confidence >= 0.8) {
    return 'OCR_MEDIUM_CONFIDENCE'
  }
  return 'OCR_LOW_CONFIDENCE'
}

/**
 * @deprecated Use determineDocumentType() instead
 */
export function selectFormatPrompt(extension: string | null | undefined): PromptPreset | null {
  if (!extension) return null
  const docType = _determineDocumentType(extension)
  if (docType === 'pdf') return null // No specific prompt for PDF (use default)
  if (docType === 'pptx') return 'PPTX'
  if (docType === 'xlsx') return 'XLSX'
  if (docType === 'docx') return 'DOCX'
  if (docType === 'image') return 'IMAGE_VISION'
  return null
}

// ============================================================================
// Template Utilities
// ============================================================================

/**
 * Validate that a prompt template contains the required {text} placeholder.
 * Logs a warning if the placeholder is missing.
 */
export function validateTemplate(template: string): boolean {
  const { logger } = obs('ai')

  if (!template.includes('{text}')) {
    logger.warn(
      'Prompt template is missing {text} placeholder. The extracted text will not be included in the prompt.',
    )
    return false
  }
  return true
}

/**
 * Substitute template variables in a prompt
 */
export function substituteVariables(
  template: string,
  context: PageContext | Record<string, unknown>,
  customVariables?: Record<string, string>,
): string {
  // Support both PageContext and generic record
  const ctx = context as PageContext
  const variables: Record<string, string | number> = {
    text: ctx.text ?? '',
    page: ctx.page ?? 1,
    total_pages: ctx.totalPages ?? 1,
    totalPages: ctx.totalPages ?? 1,
    language: ctx.language ?? 'eng',
    page_kind: ctx.pageKind ?? 'unknown',
    pageKind: ctx.pageKind ?? 'unknown',
    previous_tail: ctx.previousTail ?? '',
    previousTail: ctx.previousTail ?? '',
    run_index: ctx.runIndex ?? 0,
    runIndex: ctx.runIndex ?? 0,
    ...customVariables,
  }

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = variables[key]
    return value !== undefined ? String(value) : match
  })
}

/**
 * Build a prompt with optional continuity context
 */
export function buildPrompt(
  template: string,
  context: PageContext | Record<string, unknown>,
  options?: {
    includeContinuity?: boolean
    customVariables?: Record<string, string>
  },
): string {
  // Validate template has required placeholders
  validateTemplate(template)

  let prompt = template

  // Add continuity prefix for multi-page documents (not first page)
  const ctx = context as PageContext
  if (options?.includeContinuity && ctx.page > 1 && ctx.previousTail) {
    prompt = CONTINUITY_PROMPT_PREFIX + prompt
  }

  return substituteVariables(prompt, context, options?.customVariables)
}

/**
 * Extend a base prompt with modifications
 */
export function extendPrompt(
  base: string,
  options: {
    prepend?: string
    append?: string
    variables?: Record<string, string>
  },
): string {
  let result = base

  if (options.prepend) {
    result = options.prepend + result
  }

  if (options.append) {
    result = result + options.append
  }

  // Variables are applied at runtime via substituteVariables
  return result
}

// ============================================================================
// Deprecated interfaces - use PromptOptions from pipeline instead
// ============================================================================

/** @deprecated Use PromptOptions from lib/pipeline/prompts.ts instead */
export interface VisionPromptOptions {
  textReliability: 'digital' | 'ocr-high' | 'ocr-medium' | 'ocr-low' | 'none'
  documentType: 'pdf' | 'pptx' | 'xlsx' | 'docx' | 'image'
}

/** @deprecated Use composePrompt() from lib/pipeline/prompts.ts instead */
export function composeVisionPrompt(options: VisionPromptOptions): string {
  return _composePrompt({
    mode: 'vision',
    textReliability: options.textReliability,
    documentType: options.documentType,
  })
}

/** @deprecated Use buildPromptForExtraction() from lib/pipeline/prompts.ts instead */
export function buildVisionPromptForExtraction(options: VisionPromptOptions): string {
  return _buildPromptForExtraction({
    mode: 'vision',
    textReliability: options.textReliability,
    documentType: options.documentType,
  })
}

/** @deprecated Use buildPromptForExtraction() from lib/pipeline/prompts.ts instead */
export function buildPromptWithTextPlaceholder(options: VisionPromptOptions): string {
  return _buildPromptForExtraction({
    mode: 'text-only',
    textReliability: options.textReliability,
    documentType: options.documentType,
  })
}
