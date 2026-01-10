import { describe, expect, it, vi } from 'vitest'

// Mock AI SDK providers before importing createModel
vi.mock('@ai-sdk/openai', () => ({
  openai: {
    responses: vi.fn((modelId: string) => ({
      _type: 'openai-responses',
      modelId,
    })),
  },
}))

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((modelId: string) => ({
    _type: 'anthropic',
    modelId,
  })),
}))

vi.mock('@ai-sdk/google', () => ({
  google: vi.fn((modelId: string) => ({
    _type: 'google',
    modelId,
  })),
}))

import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
// Import after mocks are set up
import { openai } from '@ai-sdk/openai'
import { createModel } from './createModel.js'

describe('createModel', () => {
  describe('OpenAI provider', () => {
    it('creates OpenAI responses model', () => {
      const model = createModel({ provider: 'openai', modelId: 'gpt-4', effort: null })

      expect(openai.responses).toHaveBeenCalledWith('gpt-4')
      expect(model).toHaveProperty('_type', 'openai-responses')
      expect(model).toHaveProperty('modelId', 'gpt-4')
    })

    it('creates model with different model IDs', () => {
      createModel({ provider: 'openai', modelId: 'gpt-3.5-turbo', effort: null })
      createModel({ provider: 'openai', modelId: 'gpt-4-turbo', effort: null })

      expect(openai.responses).toHaveBeenCalledWith('gpt-3.5-turbo')
      expect(openai.responses).toHaveBeenCalledWith('gpt-4-turbo')
    })
  })

  describe('Anthropic provider', () => {
    it('creates Anthropic model', () => {
      const model = createModel({ provider: 'anthropic', modelId: 'claude-opus-4-5', effort: null })

      expect(anthropic).toHaveBeenCalledWith('claude-opus-4-5')
      expect(model).toHaveProperty('_type', 'anthropic')
      expect(model).toHaveProperty('modelId', 'claude-opus-4-5')
    })

    it('creates model with different model IDs', () => {
      createModel({ provider: 'anthropic', modelId: 'claude-sonnet-4-5', effort: null })
      createModel({ provider: 'anthropic', modelId: 'claude-haiku-4-5', effort: null })

      expect(anthropic).toHaveBeenCalledWith('claude-sonnet-4-5')
      expect(anthropic).toHaveBeenCalledWith('claude-haiku-4-5')
    })
  })

  describe('Google provider', () => {
    it('creates Google model', () => {
      const model = createModel({ provider: 'google', modelId: 'gemini-pro', effort: null })

      expect(google).toHaveBeenCalledWith('gemini-pro')
      expect(model).toHaveProperty('_type', 'google')
      expect(model).toHaveProperty('modelId', 'gemini-pro')
    })

    it('creates model with different model IDs', () => {
      createModel({ provider: 'google', modelId: 'gemini-1.5-pro', effort: null })
      createModel({ provider: 'google', modelId: 'gemini-ultra', effort: null })

      expect(google).toHaveBeenCalledWith('gemini-1.5-pro')
      expect(google).toHaveBeenCalledWith('gemini-ultra')
    })
  })

  describe('return type', () => {
    it('returns LanguageModel for provider models', () => {
      const openaiModel = createModel({ provider: 'openai', modelId: 'gpt-4', effort: null })
      const anthropicModel = createModel({
        provider: 'anthropic',
        modelId: 'claude-opus-4-5',
        effort: null,
      })
      const googleModel = createModel({ provider: 'google', modelId: 'gemini-pro', effort: null })

      // These should be objects (LanguageModel instances)
      expect(typeof openaiModel).toBe('object')
      expect(typeof anthropicModel).toBe('object')
      expect(typeof googleModel).toBe('object')
    })
  })
})
