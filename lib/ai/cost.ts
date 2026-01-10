/**
 * Cost estimation utilities for LLM API calls
 *
 * These estimates are approximate and may vary by:
 * - Content type (code ~1 char/token, English ~4 chars/token)
 * - Model-specific tokenization
 * - Prompt structure and formatting
 *
 * Actual costs may differ by 10-30% from estimates.
 */

import { getProvider } from './provider.js'
import type { CostEstimate, LlmConfig, ModelPricing } from './types.js'

/**
 * Approximate characters per token.
 * - English prose: ~4 chars/token
 * - Code: ~2-3 chars/token
 * - Mixed content: ~3.5 chars/token
 * Using 3.5 for conservative estimates on mixed PDF/document content.
 */
const CHARS_PER_TOKEN = 3.5

/**
 * Estimated output/input ratio for markdown formatting.
 * Markdown formatting typically produces similar or slightly less output
 * than input (removes redundant formatting, normalizes whitespace).
 * Using 1.0 for more accurate estimates.
 */
const OUTPUT_RATIO = 1.0

/**
 * Approximate image tokens by resolution tier.
 * Based on OpenAI's vision pricing model (most common reference).
 * - Low detail: 85 tokens (512x512 or smaller)
 * - Medium: ~170 tokens (up to 768x768)
 * - High detail: ~680 tokens (larger images, uses tiling)
 */
const IMAGE_TOKENS = {
  low: 85,
  medium: 170,
  high: 680,
} as const

/**
 * Estimate token count for text
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Estimate token count for an image based on dimensions.
 * Uses max-dimension to match OpenAI's tiling model.
 */
export function estimateImageTokens(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0
  const maxDim = Math.max(width, height)
  if (maxDim <= 512) return IMAGE_TOKENS.low
  if (maxDim <= 768) return IMAGE_TOKENS.medium
  return IMAGE_TOKENS.high
}

/**
 * Calculate cost for token usage
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  imageTokens: number,
  pricing: ModelPricing,
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  const imageCost = pricing.image ? (imageTokens / 1_000_000) * pricing.image : 0

  return inputCost + outputCost + imageCost
}

/**
 * Estimate cost for formatting a document
 */
export function estimateCost(
  pages: Array<{ text: string; imageWidth?: number; imageHeight?: number }>,
  config: LlmConfig,
  vision: boolean,
): CostEstimate {
  const provider = getProvider(config.provider)
  if (!provider) {
    throw new Error(`Unknown provider: ${config.provider}`)
  }

  const model = config.model ?? provider.defaultModel
  const pricing = provider.getPricing(model)

  let totalInputTokens = 0
  let totalImageTokens = 0

  for (const page of pages) {
    totalInputTokens += estimateTextTokens(page.text)

    if (vision && page.imageWidth && page.imageHeight) {
      totalImageTokens += estimateImageTokens(page.imageWidth, page.imageHeight)
    }
  }

  // Estimate output tokens based on input
  const totalOutputTokens = Math.ceil(totalInputTokens * OUTPUT_RATIO)

  const totalCost = calculateCost(totalInputTokens, totalOutputTokens, totalImageTokens, pricing)

  return {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    imageTokens: totalImageTokens,
    totalCost,
    model,
    provider: config.provider,
  }
}

/**
 * Format cost estimate for display
 */
export function formatCostEstimate(estimate: CostEstimate): string {
  const lines = [
    `Estimated API cost: ~$${estimate.totalCost.toFixed(2)}`,
    `  Input tokens: ${estimate.inputTokens.toLocaleString()}`,
    `  Output tokens: ${estimate.outputTokens.toLocaleString()}`,
  ]

  if (estimate.imageTokens > 0) {
    lines.push(`  Image tokens: ${estimate.imageTokens.toLocaleString()}`)
  }

  lines.push(`  Provider: ${estimate.provider} (${estimate.model})`)

  return lines.join('\n')
}

/**
 * Format a short cost warning for CLI
 */
export function formatCostWarning(
  estimate: CostEstimate,
  pageCount: number,
  vision: boolean,
): string {
  const mode = vision ? 'vision (text + image)' : 'text-only'
  return `⚠️  Estimated API cost: ~$${estimate.totalCost.toFixed(2)}
    Pages: ${pageCount}
    Mode: ${mode}
    Provider: ${capitalize(estimate.provider)} (${estimate.model})`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
