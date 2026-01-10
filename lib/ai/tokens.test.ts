import { describe, expect, it } from 'vitest'

import { countTokens } from './tokenCounter.js'
import { calculateMaxOutputTokens, getMaxOutputTokens, MIN_OUTPUT_TOKENS } from './tokens.js'

/** Generate diverse prose that tokenizes realistically (not repetitive single chars) */
function diverseProse(approxChars: number): string {
  const words =
    'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'
  let result = ''
  while (result.length < approxChars) result += `${words} `
  return result.slice(0, approxChars)
}

describe('calculateMaxOutputTokens', () => {
  it('returns minimum for tiny input', () => {
    expect(calculateMaxOutputTokens('Hi', 'gpt-5-nano')).toBe(MIN_OUTPUT_TOKENS)
  })

  it('returns minimum for empty input', () => {
    expect(calculateMaxOutputTokens('', 'gpt-5-nano')).toBe(MIN_OUTPUT_TOKENS)
  })

  it('scales with input size for large inputs', () => {
    // Need inputs large enough to exceed MIN_OUTPUT_TOKENS (8192)
    // 8192 / 1.5 * 4 = ~21845 chars needed to exceed minimum
    const medium = calculateMaxOutputTokens('x'.repeat(25000), 'gpt-5.2') // uses gpt-5.2 for higher limit
    const large = calculateMaxOutputTokens('x'.repeat(50000), 'gpt-5.2')
    expect(large).toBeGreaterThan(medium)
  })

  it('respects model-specific limits', () => {
    // Generate enough diverse text that tokenized × 1.5 exceeds the 128000 model limit
    const huge = diverseProse(600000)
    const modelMax = getMaxOutputTokens('gpt-5-nano')
    expect(calculateMaxOutputTokens(huge, 'gpt-5-nano')).toBe(modelMax)
    expect(calculateMaxOutputTokens(huge, 'gpt-5.2')).toBe(getMaxOutputTokens('gpt-5.2'))
  })

  it('uses default limit for unknown models', () => {
    // For unknown models, getMaxOutputTokens returns DEFAULT_MAX_OUTPUT_TOKENS (8192)
    // With enough input, estimated output exceeds that and gets clamped
    const huge = diverseProse(200000)
    const tokens = countTokens(huge, 'unknown-model')
    const estimated = Math.ceil(tokens * 1.5)
    // Should be clamped to model max (DEFAULT_MAX_OUTPUT_TOKENS for unknown)
    expect(calculateMaxOutputTokens(huge, 'unknown-model')).toBe(
      Math.min(estimated, getMaxOutputTokens('unknown-model')),
    )
  })

  it('returns minimum for typical page size', () => {
    // A typical page might have ~3000 characters
    // Estimated: 3000/4 * 1.5 = 1125, but MIN_OUTPUT_TOKENS = 8192
    const pageText = 'x'.repeat(3000)
    const tokens = calculateMaxOutputTokens(pageText, 'gpt-5-nano')

    // Should return MIN_OUTPUT_TOKENS since estimate is below minimum
    expect(tokens).toBe(MIN_OUTPUT_TOKENS)
  })

  it('handles CJK text appropriately', () => {
    // Japanese text - more tokens per character
    const japaneseText = 'こんにちは'.repeat(100) // 500 CJK chars
    const tokens = calculateMaxOutputTokens(japaneseText, 'gpt-5-nano')

    // 500 chars / 1.5 = ~333 input tokens
    // 333 * 1.5 = ~500 estimated output
    // But minimum is 1024
    expect(tokens).toBe(MIN_OUTPUT_TOKENS)
  })

  it('handles Anthropic models', () => {
    // Generate enough diverse text that tokenized × 1.5 exceeds the 64000 model limit
    const text = diverseProse(400000)
    const tokens = calculateMaxOutputTokens(text, 'claude-sonnet-4-5')
    expect(tokens).toBe(getMaxOutputTokens('claude-sonnet-4-5'))
  })

  it('handles Google models', () => {
    // Generate enough diverse text that tokenized × 1.5 exceeds the 65536 model limit
    const text = diverseProse(400000)
    const tokens = calculateMaxOutputTokens(text, 'gemini-3-flash-preview')
    expect(tokens).toBe(getMaxOutputTokens('gemini-3-flash-preview'))
  })
})
