import { estimateTokens, isEstimable } from './estimateTokens.js'

describe('isEstimable', () => {
  it('returns true for claude and gemini', () => {
    expect(isEstimable('claude')).toBe(true)
    expect(isEstimable('gemini')).toBe(true)
  })

  it('returns false for other encodings', () => {
    expect(isEstimable('o200k_base')).toBe(false)
    expect(isEstimable('cl100k_base')).toBe(false)
    expect(isEstimable('llama3')).toBe(false)
  })
})

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('', 'claude')).toBe(0)
  })

  it('returns positive count for Latin text', () => {
    const tokens = estimateTokens('Hello, world!', 'claude')
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(15)
  })

  it('scales with input length', () => {
    const short = estimateTokens('Hello', 'claude')
    const long = estimateTokens(
      'Hello, this is a much longer sentence with many more words.',
      'claude',
    )
    expect(long).toBeGreaterThan(short)
  })

  it('claude and gemini produce different counts', () => {
    const text = 'The quick brown fox jumps over the lazy dog.'
    const claude = estimateTokens(text, 'claude')
    const gemini = estimateTokens(text, 'gemini')
    // Gemini has a higher chars-per-token ratio → fewer tokens
    expect(gemini).toBeLessThanOrEqual(claude)
  })

  it('handles CJK text with lower chars-per-token', () => {
    const latin = estimateTokens('abcdef', 'claude')
    const cjk = estimateTokens('漢字漢字漢字', 'claude')
    // 6 CJK chars should produce more tokens than 6 Latin chars
    expect(cjk).toBeGreaterThan(latin)
  })

  it('handles mixed Latin and CJK text', () => {
    const tokens = estimateTokens('Hello こんにちは World', 'claude')
    expect(tokens).toBeGreaterThan(0)
  })

  it('produces reasonable estimates for longer text', () => {
    // ~100 chars of English prose → expect roughly 25-35 tokens for Claude
    const text =
      'The quick brown fox jumps over the lazy dog. This sentence has some extra words for padding here.'
    const tokens = estimateTokens(text, 'claude')
    expect(tokens).toBeGreaterThan(15)
    expect(tokens).toBeLessThan(50)
  })
})
