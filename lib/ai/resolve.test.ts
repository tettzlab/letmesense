import { _resetRegistryCache } from './models.js'
import { ResolveModelError, resolveModel } from './resolve.js'

beforeAll(() => _resetRegistryCache())

describe('resolveModel', () => {
  describe('2-segment parsing', () => {
    it('resolves openai:gpt-5-mini', () => {
      const result = resolveModel('openai:gpt-5-mini')
      expect(result.provider).toBe('openai')
      expect(result.modelId).toBe('gpt-5-mini')
      expect(result.modelConfig).not.toBeNull()
      expect(result.encoding).toBe('o200k_base')
    })

    it('resolves anthropic:claude-opus-4-6', () => {
      const result = resolveModel('anthropic:claude-opus-4-6')
      expect(result.provider).toBe('anthropic')
      expect(result.modelId).toBe('claude-opus-4-6')
      expect(result.encoding).toBe('claude')
    })

    it('resolves google:gemini-3-flash-preview', () => {
      const result = resolveModel('google:gemini-3-flash-preview')
      expect(result.provider).toBe('google')
      expect(result.modelId).toBe('gemini-3-flash-preview')
      expect(result.encoding).toBe('gemini')
    })

    it('resolves azure:my-deployment (unknown model, valid provider)', () => {
      const result = resolveModel('azure:my-deployment')
      expect(result.provider).toBe('azure')
      expect(result.modelId).toBe('my-deployment')
      expect(result.modelConfig).toBeNull()
      expect(result.encoding).toBe('o200k_base')
    })
  })

  describe('alias resolution', () => {
    it('resolves openai:mini to gpt-5-mini', () => {
      const result = resolveModel('openai:mini')
      expect(result.modelId).toBe('gpt-5-mini')
    })

    it('resolves anthropic:sonnet to claude-sonnet-4-6', () => {
      const result = resolveModel('anthropic:sonnet')
      expect(result.modelId).toBe('claude-sonnet-4-6')
    })

    it('resolves google:flash to gemini-3-flash-preview', () => {
      const result = resolveModel('google:flash')
      expect(result.modelId).toBe('gemini-3-flash-preview')
    })
  })

  describe('1-segment with providerId', () => {
    it('resolves bare model ID with provider', () => {
      const result = resolveModel('gpt-5-mini', 'openai')
      expect(result.provider).toBe('openai')
      expect(result.modelId).toBe('gpt-5-mini')
    })

    it('resolves bare alias with provider', () => {
      const result = resolveModel('mini', 'openai')
      expect(result.modelId).toBe('gpt-5-mini')
    })

    it('throws without provider for bare model', () => {
      expect(() => resolveModel('gpt-5-mini')).toThrow(ResolveModelError)
      expect(() => resolveModel('gpt-5-mini')).toThrow(/requires a provider/)
    })
  })

  describe('3-segment effort parsing', () => {
    it('resolves openai:mini:medium', () => {
      const result = resolveModel('openai:mini:medium')
      expect(result.modelId).toBe('gpt-5-mini')
      expect(result.effort).toBe('medium')
    })

    it('resolves anthropic:opus:high', () => {
      const result = resolveModel('anthropic:opus:high')
      expect(result.modelId).toBe('claude-opus-4-6')
      expect(result.effort).toBe('high')
    })

    it('resolves google:flash:minimal', () => {
      const result = resolveModel('google:flash:minimal')
      expect(result.modelId).toBe('gemini-3-flash-preview')
      expect(result.effort).toBe('minimal')
    })
  })

  describe('default effort', () => {
    it('fills default effort for models with reasoning', () => {
      const result = resolveModel('openai:mini')
      expect(result.effort).toBe('medium')
    })

    it('fills default effort "none" for GPT-5.2', () => {
      const result = resolveModel('openai:gpt-5.2')
      expect(result.effort).toBe('none')
    })

    it('returns null effort for models without reasoning', () => {
      const result = resolveModel('ollama:llama3.3')
      expect(result.effort).toBeNull()
    })

    it('returns null effort for unknown models', () => {
      const result = resolveModel('openai:unknown-model')
      expect(result.effort).toBeNull()
    })
  })

  describe('defaults for unknown models', () => {
    it('returns null modelConfig for unknown model', () => {
      const result = resolveModel('openai:gpt-6-turbo')
      expect(result.modelConfig).toBeNull()
    })

    it('uses provider default encoding for unknown model', () => {
      const result = resolveModel('openai:gpt-6-turbo')
      expect(result.encoding).toBe('o200k_base')
    })

    it('uses default context window for unknown model', () => {
      const result = resolveModel('openai:gpt-6-turbo')
      expect(result.contextWindow).toBe(128000)
    })

    it('returns conservative default pricing for unknown model', () => {
      const result = resolveModel('openai:gpt-6-turbo')
      expect(result.pricing.input).toBe(1.0)
      expect(result.pricing.output).toBe(4.0)
    })
  })

  describe('filled config fields', () => {
    it('fills pricing from model config', () => {
      const result = resolveModel('openai:gpt-5-mini')
      expect(result.pricing).toEqual({ input: 0.25, output: 2.0, image: 0.25 })
    })

    it('fills contextWindow', () => {
      const result = resolveModel('openai:gpt-5-mini')
      expect(result.contextWindow).toBe(400000)
    })

    it('fills maxOutputTokens', () => {
      const result = resolveModel('openai:gpt-5-mini')
      expect(result.maxOutputTokens).toBe(128000)
    })

    it('fills temperature config from model', () => {
      const result = resolveModel('anthropic:sonnet')
      expect(result.temperature.min).toBe(0)
      expect(result.temperature.max).toBe(1)
      expect(result.temperature.default).toBe(1)
    })

    it('falls back to default temperature when model has none', () => {
      const result = resolveModel('openai:gpt-5-mini')
      expect(result.temperature.min).toBe(0)
      expect(result.temperature.max).toBe(2)
      expect(result.temperature.default).toBe(1)
    })
  })

  describe('error handling', () => {
    it('throws INVALID_FORMAT for too many segments', () => {
      expect(() => resolveModel('openai:mini:medium:extra')).toThrow(ResolveModelError)
      try {
        resolveModel('openai:mini:medium:extra')
      } catch (err) {
        expect((err as ResolveModelError).code).toBe('INVALID_FORMAT')
      }
    })

    it('throws UNKNOWN_PROVIDER', () => {
      expect(() => resolveModel('fakeprovider:gpt-4')).toThrow(ResolveModelError)
      try {
        resolveModel('fakeprovider:gpt-4')
      } catch (err) {
        expect((err as ResolveModelError).code).toBe('UNKNOWN_PROVIDER')
      }
    })

    it('throws MISSING_MODEL for empty model', () => {
      expect(() => resolveModel('openai:')).toThrow(ResolveModelError)
      try {
        resolveModel('openai:')
      } catch (err) {
        expect((err as ResolveModelError).code).toBe('MISSING_MODEL')
      }
    })

    it('throws EFFORT_NOT_SUPPORTED for models without reasoning', () => {
      expect(() => resolveModel('ollama:llama3.3:medium')).toThrow(ResolveModelError)
      try {
        resolveModel('ollama:llama3.3:medium')
      } catch (err) {
        expect((err as ResolveModelError).code).toBe('EFFORT_NOT_SUPPORTED')
      }
    })

    it('throws INVALID_EFFORT for invalid level', () => {
      expect(() => resolveModel('openai:mini:extreme')).toThrow(ResolveModelError)
      try {
        resolveModel('openai:mini:extreme')
      } catch (err) {
        expect((err as ResolveModelError).code).toBe('INVALID_EFFORT')
      }
    })
  })
})
