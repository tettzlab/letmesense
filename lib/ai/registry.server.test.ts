// Use vi.hoisted to ensure mockLogger is available during mock setup
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// Mock AI SDK providers
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

// Mock observability - use the shared mockLogger
vi.mock('../observability/index.js', () => ({
  obs: () => ({
    logger: mockLogger,
  }),
}))

import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { ParseModelSpecError } from './config.js'
import { registry } from './registry.server.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registry.languageModel', () => {
  describe('valid model specs', () => {
    it('creates OpenAI model from spec', () => {
      const model = registry.languageModel('openai:gpt-5-mini')

      expect(openai.responses).toHaveBeenCalledWith('gpt-5-mini')
      expect(model).toHaveProperty('_type', 'openai-responses')
      expect(model).toHaveProperty('modelId', 'gpt-5-mini')
    })

    it('creates Anthropic model from spec', () => {
      const model = registry.languageModel('anthropic:claude-opus-4-6')

      expect(anthropic).toHaveBeenCalledWith('claude-opus-4-6')
      expect(model).toHaveProperty('_type', 'anthropic')
      expect(model).toHaveProperty('modelId', 'claude-opus-4-6')
    })

    it('creates Google model from spec', () => {
      const model = registry.languageModel('google:gemini-3-pro-preview')

      expect(google).toHaveBeenCalledWith('gemini-3-pro-preview')
      expect(model).toHaveProperty('_type', 'google')
      expect(model).toHaveProperty('modelId', 'gemini-3-pro-preview')
    })
  })

  describe('alias resolution', () => {
    it('resolves anthropic:sonnet alias', () => {
      const model = registry.languageModel('anthropic:sonnet')

      expect(anthropic).toHaveBeenCalledWith('claude-sonnet-4-6')
      expect(model).toHaveProperty('modelId', 'claude-sonnet-4-6')
    })

    it('resolves openai:nano alias', () => {
      const model = registry.languageModel('openai:nano')

      expect(openai.responses).toHaveBeenCalledWith('gpt-5-nano')
      expect(model).toHaveProperty('modelId', 'gpt-5-nano')
    })

    it('resolves google:flash alias', () => {
      const model = registry.languageModel('google:flash')

      expect(google).toHaveBeenCalledWith('gemini-3-flash-preview')
      expect(model).toHaveProperty('modelId', 'gemini-3-flash-preview')
    })
  })

  describe('unknown model warning', () => {
    it('warns for unknown model but still creates it', () => {
      const model = registry.languageModel('openai:gpt-99-future')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        { provider: 'openai', modelId: 'gpt-99-future' },
        expect.stringContaining('Unknown model "gpt-99-future"'),
      )
      expect(openai.responses).toHaveBeenCalledWith('gpt-99-future')
      expect(model).toHaveProperty('modelId', 'gpt-99-future')
    })

    it('does not warn for known models', () => {
      registry.languageModel('openai:gpt-5-nano')

      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('throws for invalid format (missing colon)', () => {
      expect(() => registry.languageModel('openai-gpt-5' as `openai:${string}`)).toThrow(
        ParseModelSpecError,
      )
    })

    it('throws for unknown provider', () => {
      expect(() => registry.languageModel('azure:gpt-4' as `openai:${string}`)).toThrow(
        ParseModelSpecError,
      )
    })

    it('throws for empty model', () => {
      expect(() => registry.languageModel('openai:' as `openai:${string}`)).toThrow(
        ParseModelSpecError,
      )
    })
  })
})

describe('barrel exports', () => {
  it('exports all values from index.server.js', async () => {
    const exports = await import('./index.server.js')

    expect(exports.getProviders).toBeDefined()
    expect(exports.getModels).toBeDefined()
    expect(exports.getDefaultProvider).toBeDefined()
    expect(exports.parseModelSpec).toBeDefined()
    expect(exports.createModel).toBeDefined()
    expect(exports.registry).toBeDefined()
    expect(exports.TOKEN_LIMITS).toBeDefined()
  })
})
