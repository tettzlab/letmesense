/**
 * Token utilities for dynamic output limits and context management.
 *
 * Model-specific limits are derived from the model registry in models.ts.
 */

import { getModel } from './models.js'
import { countTokens } from './tokenCounter.js'

// Re-export for convenience
export { countTokensByProvider, countTokensWithEncoding } from './tokenCounter.js'
export { countTokens }

/** Default output limit when model is not in the lookup table */
export const DEFAULT_OUTPUT_LIMIT = 20480

/** Minimum output tokens to request (safe default for most content) */
export const MIN_OUTPUT_TOKENS = 8192

/** Get context window for model */
export function getContextWindow(modelId: string): number {
  return getModel(modelId)?.contextWindow ?? 128_000
}

/** Get max output tokens for model */
export function getMaxOutputTokens(modelId: string): number {
  return getModel(modelId)?.maxOutputTokens ?? 8192
}

/**
 * Detect if text is CJK-heavy (Chinese, Japanese, Korean).
 * CJK text consumes significantly more tokens per character.
 */
export function isCjkHeavy(text: string): boolean {
  if (!text || text.length === 0) return false
  const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g
  const cjkChars = (text.match(cjkPattern) || []).length
  return cjkChars / text.length > 0.3
}

/**
 * Calculate dynamic max output tokens based on input size and model limits.
 *
 * For text formatting tasks, the output is typically similar size to input,
 * with additional overhead for markdown formatting (headers, lists, etc.).
 *
 * CJK text requires a higher multiplier because:
 * - Each CJK character is ~0.67 tokens on input
 * - Formatted output includes headings, spacing, and markdown syntax
 * - Models may generate explanatory text in addition to formatting
 *
 * @param inputText - The input text being processed
 * @param model - The model being used
 * @returns Calculated max output tokens, clamped to model limits
 */
export function calculateMaxOutputTokens(inputText: string, model: string): number {
  const inputTokens = countTokens(inputText, model)

  // CJK text needs higher multiplier due to token density and formatting overhead
  // Latin text: 1.5x is usually sufficient
  // CJK text: 3x to account for dense tokenization and markdown expansion
  const multiplier = isCjkHeavy(inputText) ? 3.0 : 1.5
  const estimated = Math.ceil(inputTokens * multiplier)

  const modelMax = getMaxOutputTokens(model)

  // Clamp between minimum and model maximum
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(estimated, modelMax))
}
