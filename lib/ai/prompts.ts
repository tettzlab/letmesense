/**
 * Prompt template utilities and legacy constants.
 *
 * For the new prompt composition framework, see lib/pipeline/prompts.ts
 */

import { obs } from '../observability/index.js'
import type { PageContext } from './types.js'

// Re-export composition framework from pipeline (canonical location)
export {
  buildPromptForExtraction,
  composePrompt,
  type DocumentType,
  determineDocumentType,
  determineTextReliability,
  type ExtractionMode,
  PROMPTS,
  type PromptOptions,
  type PromptPreset,
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
// Primary Prompt Constants (used by ai/format.ts and office/vision/processor.ts)
// ============================================================================

import {
  VISION_DIGITAL_PDF as DEFAULT_VISION_PROMPT_INTERNAL,
  TEXT_ONLY_DIGITAL_PDF as TEXT_ONLY_PROMPT_INTERNAL,
} from '../pipeline/prompts.js'

/**
 * Default text-only formatting prompt.
 * Generated from: mode='text-only', textReliability='digital', documentType='pdf'
 */
export const DEFAULT_TEXT_PROMPT = TEXT_ONLY_PROMPT_INTERNAL
export const DEFAULT_VISION_PROMPT = DEFAULT_VISION_PROMPT_INTERNAL

/** Prompt with page continuity context */
export const CONTINUITY_PROMPT_PREFIX = `Context: You are formatting page {page} of {totalPages}.
Previous page ended with: "{previousTail}"

Maintain continuity - if the previous context suggests a list, section, or sentence continues, preserve that continuity in your formatting.

`

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
