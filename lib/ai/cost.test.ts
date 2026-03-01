// Register all providers
import { registerAllProviders } from './bootstrap.js'
import {
  calculateCost,
  estimateCost,
  estimateImageTokens,
  estimateTextTokens,
  formatCostEstimate,
  formatCostWarning,
} from './cost.js'

registerAllProviders()

describe('estimateTextTokens', () => {
  it('estimates tokens at ~3.5 chars per token', () => {
    expect(estimateTextTokens('')).toBe(0)
    // 3.5 chars = 1 token, 7 chars = 2 tokens
    expect(estimateTextTokens('123')).toBe(1) // ceil(3/3.5) = 1
    expect(estimateTextTokens('1234567')).toBe(2) // ceil(7/3.5) = 2
    expect(estimateTextTokens('12345678901')).toBe(4) // ceil(11/3.5) = 4
  })

  it('handles long text', () => {
    const longText = 'a'.repeat(3500)
    expect(estimateTextTokens(longText)).toBe(1000) // 3500/3.5 = 1000
  })
})

describe('estimateImageTokens', () => {
  it('returns low tier for small images', () => {
    expect(estimateImageTokens(512, 512)).toBe(85)
    expect(estimateImageTokens(256, 256)).toBe(85)
    expect(estimateImageTokens(100, 100)).toBe(85)
  })

  it('returns medium tier for medium images', () => {
    expect(estimateImageTokens(600, 600)).toBe(170)
    expect(estimateImageTokens(768, 768)).toBe(170)
  })

  it('returns high tier for large images', () => {
    expect(estimateImageTokens(800, 800)).toBe(680)
    expect(estimateImageTokens(1024, 1024)).toBe(680)
    expect(estimateImageTokens(2048, 2048)).toBe(680)
  })
})

describe('calculateCost', () => {
  it('calculates cost based on pricing per 1M tokens', () => {
    const pricing = { input: 1.0, output: 2.0, image: 0.5 }

    // 1M input tokens = $1.00
    // 1M output tokens = $2.00
    // 1M image tokens = $0.50
    const cost = calculateCost(1_000_000, 1_000_000, 1_000_000, pricing)
    expect(cost).toBe(3.5)
  })

  it('handles smaller token counts', () => {
    const pricing = { input: 1.0, output: 2.0, image: null }

    // 1000 input = $0.001
    // 500 output = $0.001
    const cost = calculateCost(1000, 500, 0, pricing)
    expect(cost).toBeCloseTo(0.002)
  })

  it('ignores image cost when null', () => {
    const pricing = { input: 1.0, output: 2.0, image: null }
    const cost = calculateCost(1000, 1000, 1000, pricing)
    expect(cost).toBeCloseTo(0.003) // Only input + output
  })
})

describe('estimateCost', () => {
  it('estimates cost for text-only pages', () => {
    // With CHARS_PER_TOKEN=3.5, 3500 chars = 1000 tokens
    const pages = [
      { text: 'a'.repeat(3500) }, // 1000 tokens
      { text: 'b'.repeat(3500) }, // 1000 tokens
    ]

    const estimate = estimateCost(pages, { provider: 'openai' }, false)

    expect(estimate.inputTokens).toBe(2000)
    expect(estimate.outputTokens).toBe(2000) // 1.0x input
    expect(estimate.imageTokens).toBe(0)
    expect(estimate.provider).toBe('openai')
    expect(estimate.totalCost).toBeGreaterThan(0)
  })

  it('includes image tokens in vision mode', () => {
    const pages = [
      { text: 'Hello', imageWidth: 1024, imageHeight: 1024 },
      { text: 'World', imageWidth: 512, imageHeight: 512 },
    ]

    const estimate = estimateCost(pages, { provider: 'openai' }, true)

    expect(estimate.imageTokens).toBe(680 + 85) // high + low
    expect(estimate.inputTokens).toBeGreaterThan(0)
  })

  it('ignores image dimensions when not in vision mode', () => {
    const pages = [{ text: 'Hello', imageWidth: 1024, imageHeight: 1024 }]

    const estimate = estimateCost(pages, { provider: 'openai' }, false)

    expect(estimate.imageTokens).toBe(0)
  })

  it('uses correct model from config', () => {
    const pages = [{ text: 'Hello' }]

    const estimate = estimateCost(pages, { provider: 'openai', model: 'gpt-5.2' }, false)

    expect(estimate.model).toBe('gpt-5.2')
  })

  it('uses default model when not specified', () => {
    const pages = [{ text: 'Hello' }]

    const estimate = estimateCost(pages, { provider: 'openai' }, false)

    expect(estimate.model).toBe('gpt-5-mini')
  })

  it('works with anthropic provider', () => {
    const pages = [{ text: 'Hello world test' }]

    const estimate = estimateCost(pages, { provider: 'anthropic' }, false)

    expect(estimate.provider).toBe('anthropic')
    expect(estimate.model).toBe('claude-haiku-4-5')
    expect(estimate.totalCost).toBeGreaterThan(0)
  })

  it('throws for unknown provider', () => {
    const pages = [{ text: 'Hello' }]

    expect(() => estimateCost(pages, { provider: 'unknown' as never }, false)).toThrow(
      'Unknown provider',
    )
  })
})

describe('formatCostEstimate', () => {
  it('formats estimate for display', () => {
    const estimate = {
      inputTokens: 1000,
      outputTokens: 1500,
      imageTokens: 0,
      totalCost: 0.05,
      model: 'gpt-5-nano',
      provider: 'openai' as const,
    }

    const formatted = formatCostEstimate(estimate)

    expect(formatted).toContain('$0.05')
    expect(formatted).toContain('1,000')
    expect(formatted).toContain('1,500')
    expect(formatted).toContain('gpt-5-nano')
    expect(formatted).toContain('openai')
  })

  it('includes image tokens when present', () => {
    const estimate = {
      inputTokens: 1000,
      outputTokens: 1500,
      imageTokens: 500,
      totalCost: 0.1,
      model: 'gpt-5-mini',
      provider: 'openai' as const,
    }

    const formatted = formatCostEstimate(estimate)

    expect(formatted).toContain('Image tokens')
    expect(formatted).toContain('500')
  })

  it('omits image tokens when zero', () => {
    const estimate = {
      inputTokens: 1000,
      outputTokens: 1500,
      imageTokens: 0,
      totalCost: 0.05,
      model: 'gpt-5-nano',
      provider: 'openai' as const,
    }

    const formatted = formatCostEstimate(estimate)

    expect(formatted).not.toContain('Image tokens')
  })
})

describe('formatCostWarning', () => {
  it('formats warning for text-only mode', () => {
    const estimate = {
      inputTokens: 1000,
      outputTokens: 1500,
      imageTokens: 0,
      totalCost: 0.12,
      model: 'gpt-5-nano',
      provider: 'openai' as const,
    }

    const warning = formatCostWarning(estimate, 5, false)

    expect(warning).toContain('$0.12')
    expect(warning).toContain('Pages: 5')
    expect(warning).toContain('text-only')
    expect(warning).toContain('Openai')
    expect(warning).toContain('gpt-5-nano')
  })

  it('formats warning for vision mode', () => {
    const estimate = {
      inputTokens: 1000,
      outputTokens: 1500,
      imageTokens: 500,
      totalCost: 0.45,
      model: 'gpt-5-mini',
      provider: 'openai' as const,
    }

    const warning = formatCostWarning(estimate, 10, true)

    expect(warning).toContain('$0.45')
    expect(warning).toContain('Pages: 10')
    expect(warning).toContain('vision (text + image)')
  })
})

describe('edge cases', () => {
  describe('estimateTextTokens edge cases', () => {
    it('handles empty string', () => {
      expect(estimateTextTokens('')).toBe(0)
    })

    it('handles very long text', () => {
      const longText = 'a'.repeat(100000)
      const tokens = estimateTextTokens(longText)
      expect(tokens).toBe(Math.ceil(100000 / 3.5))
    })

    it('handles single character', () => {
      expect(estimateTextTokens('a')).toBe(1) // ceil(1/3.5) = 1
    })

    it('handles unicode text', () => {
      // Note: JS string.length counts UTF-16 code units, so CJK chars are 1 each.
      // This tests the implementation (chars/3.5), not actual tokenization.
      // Real tokenizers may use more tokens for CJK text due to byte-level encoding.
      const unicode = '你好世界' // 4 UTF-16 code units
      expect(estimateTextTokens(unicode)).toBe(Math.ceil(4 / 3.5))
    })
  })

  describe('estimateImageTokens edge cases', () => {
    it('handles very large images', () => {
      // 4K resolution
      expect(estimateImageTokens(3840, 2160)).toBe(680) // high tier
    })

    it('handles extremely large images', () => {
      // 8K resolution - should still return high tier
      expect(estimateImageTokens(7680, 4320)).toBe(680)
    })

    it('handles very small images', () => {
      expect(estimateImageTokens(1, 1)).toBe(85) // low tier
      expect(estimateImageTokens(10, 10)).toBe(85)
    })

    it('handles zero dimensions', () => {
      expect(estimateImageTokens(0, 0)).toBe(0)
    })

    it('handles one-dimensional images (degenerate cases)', () => {
      // max-dimension based: max(1000,1) = 1000 > 768 → high tier
      expect(estimateImageTokens(1000, 1)).toBe(680)
      expect(estimateImageTokens(1, 1000)).toBe(680)
    })

    it('handles boundary at 512x512', () => {
      expect(estimateImageTokens(512, 512)).toBe(85) // exactly at boundary
      expect(estimateImageTokens(513, 512)).toBe(170) // just over
    })

    it('handles boundary at 768x768', () => {
      expect(estimateImageTokens(768, 768)).toBe(170) // exactly at boundary
      expect(estimateImageTokens(769, 768)).toBe(680) // just over
    })
  })

  describe('calculateCost edge cases', () => {
    it('handles zero tokens', () => {
      const pricing = { input: 1.0, output: 2.0, image: 0.5 }
      const cost = calculateCost(0, 0, 0, pricing)
      expect(cost).toBe(0)
    })

    it('handles very large token counts', () => {
      const pricing = { input: 1.0, output: 2.0, image: null }
      // 1 billion tokens
      const cost = calculateCost(1_000_000_000, 1_000_000_000, 0, pricing)
      expect(cost).toBe(3000) // $1000 + $2000
    })

    it('handles zero pricing', () => {
      const pricing = { input: 0, output: 0, image: 0 }
      const cost = calculateCost(1_000_000, 1_000_000, 1_000_000, pricing)
      expect(cost).toBe(0)
    })
  })

  describe('estimateCost edge cases', () => {
    it('handles empty pages array', () => {
      const pages: Array<{ text: string }> = []
      const estimate = estimateCost(pages, { provider: 'openai' }, false)

      expect(estimate.inputTokens).toBe(0)
      expect(estimate.outputTokens).toBe(0)
      expect(estimate.imageTokens).toBe(0)
      expect(estimate.totalCost).toBe(0)
    })

    it('handles pages with empty text', () => {
      const pages = [{ text: '' }, { text: '' }]
      const estimate = estimateCost(pages, { provider: 'openai' }, false)

      expect(estimate.inputTokens).toBe(0)
      expect(estimate.outputTokens).toBe(0)
    })

    it('handles vision mode with missing image dimensions', () => {
      const pages = [
        { text: 'Hello' }, // No image dimensions
        { text: 'World', imageWidth: 1024, imageHeight: 1024 }, // Has dimensions
      ]
      const estimate = estimateCost(pages, { provider: 'openai' }, true)

      // Only one page should contribute image tokens
      expect(estimate.imageTokens).toBe(680) // high tier for 1024x1024
    })

    it('handles vision mode with partial image dimensions', () => {
      const pages = [
        { text: 'Hello', imageWidth: 1024 }, // Missing height
        { text: 'World', imageHeight: 768 }, // Missing width
      ]
      const estimate = estimateCost(pages, { provider: 'openai' }, true)

      // Neither should contribute image tokens (both need width AND height)
      expect(estimate.imageTokens).toBe(0)
    })

    it('handles many pages', () => {
      const pages = Array.from({ length: 1000 }, () => ({ text: 'Hello world' }))
      const estimate = estimateCost(pages, { provider: 'openai' }, false)

      expect(estimate.inputTokens).toBeGreaterThan(0)
      expect(estimate.outputTokens).toBe(estimate.inputTokens) // 1.0 ratio
    })

    it('handles mixed vision/non-vision pages in vision mode', () => {
      const pages = [
        { text: 'Text only page 1' },
        { text: 'Image page', imageWidth: 800, imageHeight: 600 },
        { text: 'Text only page 2' },
        { text: 'Large image', imageWidth: 2048, imageHeight: 2048 },
      ]
      const estimate = estimateCost(pages, { provider: 'openai' }, true)

      // max-dim: 800 > 768 → high, 2048 > 768 → high
      expect(estimate.imageTokens).toBe(680 + 680)
    })
  })

  describe('formatCostEstimate edge cases', () => {
    it('formats very small costs correctly', () => {
      const estimate = {
        inputTokens: 10,
        outputTokens: 10,
        imageTokens: 0,
        totalCost: 0.0001,
        model: 'gpt-5-nano',
        provider: 'openai' as const,
      }

      const formatted = formatCostEstimate(estimate)
      expect(formatted).toContain('$0.00')
    })

    it('formats large costs correctly', () => {
      const estimate = {
        inputTokens: 1_000_000_000,
        outputTokens: 1_000_000_000,
        imageTokens: 0,
        totalCost: 1234.56,
        model: 'gpt-5-nano',
        provider: 'openai' as const,
      }

      const formatted = formatCostEstimate(estimate)
      expect(formatted).toContain('$1234.56')
      expect(formatted).toContain('1,000,000,000')
    })
  })
})
