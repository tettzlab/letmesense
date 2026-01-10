import { describe, expect, it } from 'vitest'
import { ParseModelSpecError, parseModelSpec } from './config.js'

describe('parseModelSpec', () => {
  describe('valid specs', () => {
    it('parses openai:gpt-5-mini', () => {
      const result = parseModelSpec('openai:gpt-5-mini')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5-mini', effort: null })
    })

    it('parses anthropic:claude-opus-4-5', () => {
      const result = parseModelSpec('anthropic:claude-opus-4-5')
      expect(result).toEqual({ provider: 'anthropic', modelId: 'claude-opus-4-5', effort: null })
    })

    it('parses google:gemini-2.5-flash', () => {
      const result = parseModelSpec('google:gemini-2.5-flash')
      expect(result).toEqual({ provider: 'google', modelId: 'gemini-2.5-flash', effort: null })
    })
  })

  describe('alias resolution', () => {
    it('resolves anthropic:opus to claude-opus-4-5', () => {
      const result = parseModelSpec('anthropic:opus')
      expect(result).toEqual({ provider: 'anthropic', modelId: 'claude-opus-4-5', effort: null })
    })

    it('resolves anthropic:sonnet to full model ID', () => {
      const result = parseModelSpec('anthropic:sonnet')
      expect(result).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-5', effort: null })
    })

    it('resolves anthropic:haiku to full model ID', () => {
      const result = parseModelSpec('anthropic:haiku')
      expect(result).toEqual({ provider: 'anthropic', modelId: 'claude-haiku-4-5', effort: null })
    })

    it('resolves openai:nano to gpt-5-nano', () => {
      const result = parseModelSpec('openai:nano')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5-nano', effort: null })
    })

    it('resolves openai:mini to gpt-5-mini', () => {
      const result = parseModelSpec('openai:mini')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5-mini', effort: null })
    })

    it('resolves openai:gpt to gpt-5.2', () => {
      const result = parseModelSpec('openai:gpt')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5.2', effort: null })
    })

    it('resolves google:flash to gemini-3-flash-preview', () => {
      const result = parseModelSpec('google:flash')
      expect(result).toEqual({
        provider: 'google',
        modelId: 'gemini-3-flash-preview',
        effort: null,
      })
    })

    it('resolves google:flash2 to gemini-2.5-flash', () => {
      const result = parseModelSpec('google:flash2')
      expect(result).toEqual({ provider: 'google', modelId: 'gemini-2.5-flash', effort: null })
    })

    it('resolves google:gemini to gemini-3-pro-preview', () => {
      const result = parseModelSpec('google:gemini')
      expect(result).toEqual({
        provider: 'google',
        modelId: 'gemini-3-pro-preview',
        effort: null,
      })
    })

    it('resolves google:gemini2 to gemini-2.5-pro', () => {
      const result = parseModelSpec('google:gemini2')
      expect(result).toEqual({ provider: 'google', modelId: 'gemini-2.5-pro', effort: null })
    })

    it('resolves google:pro to gemini-3-pro-preview', () => {
      const result = parseModelSpec('google:pro')
      expect(result).toEqual({
        provider: 'google',
        modelId: 'gemini-3-pro-preview',
        effort: null,
      })
    })

    it('resolves openai:gpt5 to gpt-5.2', () => {
      const result = parseModelSpec('openai:gpt5')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5.2', effort: null })
    })

    it('resolves google:gemini3 to gemini-3-pro-preview', () => {
      const result = parseModelSpec('google:gemini3')
      expect(result).toEqual({
        provider: 'google',
        modelId: 'gemini-3-pro-preview',
        effort: null,
      })
    })

    it('passes through unknown aliases as literal model IDs', () => {
      const result = parseModelSpec('openai:gpt-6-turbo')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-6-turbo', effort: null })
    })
  })

  describe('3-segment effort parsing', () => {
    it('parses openai:mini:medium', () => {
      const result = parseModelSpec('openai:mini:medium')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5-mini', effort: 'medium' })
    })

    it('parses anthropic:opus:high', () => {
      const result = parseModelSpec('anthropic:opus:high')
      expect(result).toEqual({ provider: 'anthropic', modelId: 'claude-opus-4-5', effort: 'high' })
    })

    it('parses google:flash:minimal', () => {
      const result = parseModelSpec('google:flash:minimal')
      expect(result).toEqual({
        provider: 'google',
        modelId: 'gemini-3-flash-preview',
        effort: 'minimal',
      })
    })

    it('passes through effort for unknown models', () => {
      const result = parseModelSpec('openai:gpt-6-turbo:high')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-6-turbo', effort: 'high' })
    })

    it('throws EFFORT_NOT_SUPPORTED for models without reasoning', () => {
      expect(() => parseModelSpec('ollama:llama:medium')).toThrow(ParseModelSpecError)
      try {
        parseModelSpec('ollama:llama:medium')
      } catch (err) {
        expect(err).toBeInstanceOf(ParseModelSpecError)
        expect((err as ParseModelSpecError).code).toBe('EFFORT_NOT_SUPPORTED')
      }
    })

    it('throws INVALID_EFFORT for invalid effort level', () => {
      expect(() => parseModelSpec('openai:mini:extreme')).toThrow(ParseModelSpecError)
      try {
        parseModelSpec('openai:mini:extreme')
      } catch (err) {
        expect(err).toBeInstanceOf(ParseModelSpecError)
        expect((err as ParseModelSpecError).code).toBe('INVALID_EFFORT')
      }
    })
  })

  describe('error handling', () => {
    it('throws INVALID_FORMAT for missing colon', () => {
      expect(() => parseModelSpec('openai-gpt-5')).toThrow(ParseModelSpecError)
      try {
        parseModelSpec('openai-gpt-5')
      } catch (err) {
        expect(err).toBeInstanceOf(ParseModelSpecError)
        expect((err as ParseModelSpecError).code).toBe('INVALID_FORMAT')
        expect((err as ParseModelSpecError).message).toContain('Invalid model format')
      }
    })

    it('throws INVALID_FORMAT for too many segments', () => {
      expect(() => parseModelSpec('openai:mini:medium:extra')).toThrow(ParseModelSpecError)
      try {
        parseModelSpec('openai:mini:medium:extra')
      } catch (err) {
        expect(err).toBeInstanceOf(ParseModelSpecError)
        expect((err as ParseModelSpecError).code).toBe('INVALID_FORMAT')
      }
    })

    it('throws UNKNOWN_PROVIDER for invalid provider', () => {
      expect(() => parseModelSpec('azure:gpt-4')).toThrow(ParseModelSpecError)
      try {
        parseModelSpec('azure:gpt-4')
      } catch (err) {
        expect(err).toBeInstanceOf(ParseModelSpecError)
        expect((err as ParseModelSpecError).code).toBe('UNKNOWN_PROVIDER')
        expect((err as ParseModelSpecError).message).toContain('Unknown provider')
      }
    })

    it('throws MISSING_MODEL for empty model', () => {
      expect(() => parseModelSpec('openai:')).toThrow(ParseModelSpecError)
      try {
        parseModelSpec('openai:')
      } catch (err) {
        expect(err).toBeInstanceOf(ParseModelSpecError)
        expect((err as ParseModelSpecError).code).toBe('MISSING_MODEL')
        expect((err as ParseModelSpecError).message).toContain('Missing model ID')
      }
    })
  })

  describe('whitespace handling', () => {
    it('trims leading whitespace', () => {
      const result = parseModelSpec('  openai:gpt-5-mini')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5-mini', effort: null })
    })

    it('trims trailing whitespace', () => {
      const result = parseModelSpec('openai:gpt-5-mini  ')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5-mini', effort: null })
    })

    it('trims both leading and trailing whitespace', () => {
      const result = parseModelSpec('  openai:gpt-5-mini  ')
      expect(result).toEqual({ provider: 'openai', modelId: 'gpt-5-mini', effort: null })
    })
  })
})
