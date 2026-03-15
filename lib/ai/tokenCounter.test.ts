import { _resetRegistryCache } from './models.js'
import {
  countTokens,
  countTokensByProvider,
  countTokensWithEncoding,
  MSG_TOKEN_OVERHEAD,
} from './tokenCounter.js'
import { calculateMaxOutputTokens, getMaxOutputTokens, MIN_OUTPUT_TOKENS } from './tokens.js'

beforeAll(() => _resetRegistryCache())

describe('MSG_TOKEN_OVERHEAD', () => {
  it('is 4', () => {
    expect(MSG_TOKEN_OVERHEAD).toBe(4)
  })
})

describe('countTokensWithEncoding', () => {
  it('returns 0 for empty string', () => {
    expect(countTokensWithEncoding('', 'o200k_base')).toBe(0)
  })

  it('counts tokens with cl100k_base encoding', () => {
    const tokens = countTokensWithEncoding('Hello, world!', 'cl100k_base')
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(10)
  })

  it('counts tokens with o200k_base encoding', () => {
    const tokens = countTokensWithEncoding('Hello, world!', 'o200k_base')
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(10)
  })

  it('counts tokens with claude encoding', () => {
    const tokens = countTokensWithEncoding('Hello, world!', 'claude')
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(10)
  })

  it('counts tokens with gemini encoding', () => {
    const tokens = countTokensWithEncoding('Hello, world!', 'gemini')
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(10)
  })

  it('counts tokens with llama3 encoding', () => {
    const tokens = countTokensWithEncoding('Hello, world!', 'llama3')
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(10)
  })

  it('counts tokens with qwen2 encoding (llama3 approximation)', () => {
    const tokens = countTokensWithEncoding('Hello, world!', 'qwen2')
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(10)
    // qwen2 uses llama3 internally, should produce same result
    expect(tokens).toBe(countTokensWithEncoding('Hello, world!', 'llama3'))
  })

  it('scales with input length', () => {
    const short = countTokensWithEncoding('Hello', 'o200k_base')
    const long = countTokensWithEncoding(
      'Hello, this is a much longer sentence with many more words.',
      'o200k_base',
    )
    expect(long).toBeGreaterThan(short)
  })

  it('handles CJK text', () => {
    const tokens = countTokensWithEncoding('こんにちは世界', 'o200k_base')
    expect(tokens).toBeGreaterThan(0)
  })

  it('different encodings produce different counts for same text', () => {
    const text = 'The quick brown fox jumps over the lazy dog. This is a test of the tokenizer.'
    const o200k = countTokensWithEncoding(text, 'o200k_base')
    const claude = countTokensWithEncoding(text, 'claude')
    const gemini = countTokensWithEncoding(text, 'gemini')
    // All should be positive
    expect(o200k).toBeGreaterThan(0)
    expect(claude).toBeGreaterThan(0)
    expect(gemini).toBeGreaterThan(0)
    // At least some should differ (different tokenizers)
    const allSame = o200k === claude && claude === gemini
    expect(allSame).toBe(false)
  })
})

describe('countTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('', 'gpt-5-nano')).toBe(0)
  })

  it('counts tokens for known OpenAI model', () => {
    const tokens = countTokens('Hello, world!', 'gpt-5-nano')
    expect(tokens).toBeGreaterThan(0)
  })

  it('counts tokens for known Anthropic model', () => {
    const tokens = countTokens('Hello, world!', 'claude-sonnet-4-5')
    expect(tokens).toBeGreaterThan(0)
  })

  it('counts tokens for known Google model', () => {
    const tokens = countTokens('Hello, world!', 'gemini-3-flash-preview')
    expect(tokens).toBeGreaterThan(0)
  })

  it('counts tokens for known Ollama model', () => {
    const tokens = countTokens('Hello, world!', 'llama3.3')
    expect(tokens).toBeGreaterThan(0)
  })

  it('falls back to o200k_base for unknown model', () => {
    const unknown = countTokens('Hello, world!', 'nonexistent-model')
    const o200k = countTokensWithEncoding('Hello, world!', 'o200k_base')
    expect(unknown).toBe(o200k)
  })
})

describe('countTokensByProvider', () => {
  it('counts tokens using OpenAI default encoding', () => {
    const tokens = countTokensByProvider('Hello, world!', 'openai')
    const o200k = countTokensWithEncoding('Hello, world!', 'o200k_base')
    expect(tokens).toBe(o200k)
  })

  it('counts tokens using Anthropic default encoding', () => {
    const tokens = countTokensByProvider('Hello, world!', 'anthropic')
    const claude = countTokensWithEncoding('Hello, world!', 'claude')
    expect(tokens).toBe(claude)
  })

  it('counts tokens using Google default encoding', () => {
    const tokens = countTokensByProvider('Hello, world!', 'google')
    const gemini = countTokensWithEncoding('Hello, world!', 'gemini')
    expect(tokens).toBe(gemini)
  })

  it('counts tokens using Ollama default encoding', () => {
    const tokens = countTokensByProvider('Hello, world!', 'ollama')
    const llama3 = countTokensWithEncoding('Hello, world!', 'llama3')
    expect(tokens).toBe(llama3)
  })
})

// ── calculateMaxOutputTokens (merged from tokens.test.ts) ───────────────────

/** Generate diverse prose that tokenizes realistically (not repetitive single chars) */
function diverseProse(approxChars: number): string {
  const words =
    'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'
  let result = ''
  while (result.length < approxChars) result += `${words} `
  return result.slice(0, approxChars)
}

describe('calculateMaxOutputTokens', { timeout: 30000 }, () => {
  it('returns minimum for tiny input', () => {
    expect(calculateMaxOutputTokens('Hi', 'gpt-5-nano')).toBe(MIN_OUTPUT_TOKENS)
  })

  it('returns minimum for empty input', () => {
    expect(calculateMaxOutputTokens('', 'gpt-5-nano')).toBe(MIN_OUTPUT_TOKENS)
  })

  it('scales with input size for large inputs', () => {
    const medium = calculateMaxOutputTokens('x'.repeat(25000), 'gpt-5.2')
    const large = calculateMaxOutputTokens('x'.repeat(50000), 'gpt-5.2')
    expect(large).toBeGreaterThan(medium)
  })

  it('respects model-specific limits', () => {
    const huge = diverseProse(600000)
    const modelMax = getMaxOutputTokens('gpt-5-nano')
    expect(calculateMaxOutputTokens(huge, 'gpt-5-nano')).toBe(modelMax)
    expect(calculateMaxOutputTokens(huge, 'gpt-5.2')).toBe(getMaxOutputTokens('gpt-5.2'))
  })

  it('uses default limit for unknown models', () => {
    const huge = diverseProse(200000)
    const tokens = countTokens(huge, 'unknown-model')
    const estimated = Math.ceil(tokens * 1.5)
    expect(calculateMaxOutputTokens(huge, 'unknown-model')).toBe(
      Math.min(estimated, getMaxOutputTokens('unknown-model')),
    )
  })

  it('returns minimum for typical page size', () => {
    const pageText = 'x'.repeat(3000)
    const tokens = calculateMaxOutputTokens(pageText, 'gpt-5-nano')
    expect(tokens).toBe(MIN_OUTPUT_TOKENS)
  })

  it('handles CJK text appropriately', () => {
    const japaneseText = 'こんにちは'.repeat(100)
    const tokens = calculateMaxOutputTokens(japaneseText, 'gpt-5-nano')
    expect(tokens).toBe(MIN_OUTPUT_TOKENS)
  })

  it('handles Anthropic models', () => {
    const text = diverseProse(200000)
    const tokens = calculateMaxOutputTokens(text, 'claude-sonnet-4-5')
    expect(tokens).toBe(getMaxOutputTokens('claude-sonnet-4-5'))
  })

  it('handles Google models', () => {
    const text = diverseProse(280000)
    const tokens = calculateMaxOutputTokens(text, 'gemini-3-flash-preview')
    expect(tokens).toBe(getMaxOutputTokens('gemini-3-flash-preview'))
  })
})
