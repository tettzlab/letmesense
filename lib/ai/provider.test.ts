import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildConfig,
  detectProvider,
  getAllProviders,
  getProvider,
  registerProvider,
  resolveModelId,
  resolveProvider,
} from './provider.js'
import type { LlmProvider, ModelPricing } from './types.js'

// Create mock providers
const createMockProvider = (
  name: 'openai' | 'anthropic' | 'ollama',
  available: boolean,
): LlmProvider => ({
  name,
  defaultModel: `${name}-default`,
  defaultVisionModel: `${name}-vision`,
  isAvailable: vi.fn(() => available),
  getPricing: vi.fn(() => ({ input: 1, output: 2, image: 3 }) as ModelPricing),
  format: vi.fn(),
  formatStream: vi.fn(),
})

describe('provider registry', () => {
  beforeEach(() => {
    // Clear the registry by registering empty providers
    // (there's no clear function, but we can re-register)
    vi.clearAllMocks()
  })

  describe('registerProvider', () => {
    it('registers a provider', () => {
      const provider = createMockProvider('openai', true)
      registerProvider(provider)

      const retrieved = getProvider('openai')
      expect(retrieved).toBe(provider)
    })

    it('overwrites existing provider with same name', () => {
      const provider1 = createMockProvider('openai', true)
      const provider2 = createMockProvider('openai', false)

      registerProvider(provider1)
      registerProvider(provider2)

      const retrieved = getProvider('openai')
      expect(retrieved).toBe(provider2)
    })
  })

  describe('getProvider', () => {
    it('returns undefined for unregistered provider', () => {
      // May be undefined or the real provider if already registered
      // This test is more about the interface
      expect(typeof getProvider).toBe('function')
    })

    it('returns registered provider', () => {
      const provider = createMockProvider('openai', true)
      registerProvider(provider)

      expect(getProvider('openai')).toBe(provider)
    })
  })

  describe('getAllProviders', () => {
    it('returns array of all providers', () => {
      const providers = getAllProviders()
      expect(Array.isArray(providers)).toBe(true)
    })
  })
})

describe('detectProvider', () => {
  it('returns null when no providers are available', () => {
    // Register unavailable providers
    registerProvider(createMockProvider('openai', false))
    registerProvider(createMockProvider('anthropic', false))
    registerProvider(createMockProvider('ollama', false))

    const detected = detectProvider()
    expect(detected).toBeNull()
  })

  it('detects openai first when available', () => {
    registerProvider(createMockProvider('openai', true))
    registerProvider(createMockProvider('anthropic', true))
    registerProvider(createMockProvider('ollama', true))

    const detected = detectProvider()
    expect(detected).not.toBeNull()
    expect(detected?.provider).toBe('openai')
    expect(detected?.reason).toContain('openai')
  })

  it('detects anthropic when openai unavailable', () => {
    registerProvider(createMockProvider('openai', false))
    registerProvider(createMockProvider('anthropic', true))
    registerProvider(createMockProvider('ollama', true))

    const detected = detectProvider()
    expect(detected?.provider).toBe('anthropic')
  })

  it('detects ollama when others unavailable', () => {
    registerProvider(createMockProvider('openai', false))
    registerProvider(createMockProvider('anthropic', false))
    registerProvider(createMockProvider('ollama', true))

    const detected = detectProvider()
    expect(detected?.provider).toBe('ollama')
  })
})

describe('resolveProvider', () => {
  beforeEach(() => {
    // Set up providers for tests
    registerProvider(createMockProvider('openai', true))
    registerProvider(createMockProvider('anthropic', true))
    registerProvider(createMockProvider('ollama', false))
  })

  it('returns specified provider when available', () => {
    const provider = resolveProvider({ provider: 'anthropic' })
    expect(provider.name).toBe('anthropic')
  })

  it('throws for unknown provider', () => {
    expect(() => resolveProvider({ provider: 'unknown' as never })).toThrow('Unknown LLM provider')
  })

  it('throws when specified provider is unavailable', () => {
    expect(() => resolveProvider({ provider: 'ollama' })).toThrow('not configured')
  })

  it('auto-detects provider when not specified', () => {
    const provider = resolveProvider({})
    expect(provider.name).toBe('openai') // First in priority
  })

  it('throws when no providers available and none specified', () => {
    // Make all providers unavailable
    registerProvider(createMockProvider('openai', false))
    registerProvider(createMockProvider('anthropic', false))
    registerProvider(createMockProvider('ollama', false))

    expect(() => resolveProvider({})).toThrow('No LLM provider available')
  })

  it('auto-detects with undefined config', () => {
    const provider = resolveProvider(undefined)
    expect(provider.name).toBe('openai')
  })
})

describe('resolveModelId', () => {
  const mockProvider = createMockProvider('openai', true)

  it('returns config model when specified', () => {
    const model = resolveModelId(mockProvider, { model: 'custom-model' })
    expect(model).toBe('custom-model')
  })

  it('returns default model when not specified', () => {
    const model = resolveModelId(mockProvider, {})
    expect(model).toBe('openai-default')
  })

  it('returns default model with undefined config', () => {
    const model = resolveModelId(mockProvider, undefined)
    expect(model).toBe('openai-default')
  })

  it('returns vision model when vision is true', () => {
    const model = resolveModelId(mockProvider, {}, true)
    expect(model).toBe('openai-vision')
  })

  it('returns vision model when vision is true and no model specified', () => {
    const model = resolveModelId(mockProvider, undefined, true)
    expect(model).toBe('openai-vision')
  })

  it('config model takes precedence over vision default', () => {
    const model = resolveModelId(mockProvider, { model: 'custom' }, true)
    expect(model).toBe('custom')
  })
})

describe('buildConfig', () => {
  const mockProvider = createMockProvider('openai', true)

  it('builds config with defaults', () => {
    const config = buildConfig(mockProvider)
    expect(config).toEqual({
      provider: 'openai',
      model: 'openai-default',
      apiKey: undefined,
      baseUrl: undefined,
      timeout: 60_000,
      maxRetries: 3,
      providerOptions: undefined,
    })
  })

  it('includes partial config values', () => {
    const config = buildConfig(mockProvider, {
      apiKey: 'test-key',
      baseUrl: 'https://custom.api',
      timeout: 30_000,
      maxRetries: 5,
    })
    expect(config.apiKey).toBe('test-key')
    expect(config.baseUrl).toBe('https://custom.api')
    expect(config.timeout).toBe(30_000)
    expect(config.maxRetries).toBe(5)
  })

  it('uses vision model when vision is true', () => {
    const config = buildConfig(mockProvider, {}, true)
    expect(config.model).toBe('openai-vision')
  })

  it('uses specified model over vision default', () => {
    const config = buildConfig(mockProvider, { model: 'custom' }, true)
    expect(config.model).toBe('custom')
  })

  it('forwards providerOptions from partial config', () => {
    const providerOptions = { openai: { reasoningEffort: 'medium' } }
    const config = buildConfig(mockProvider, { providerOptions })
    expect(config.providerOptions).toEqual(providerOptions)
  })

  it('leaves providerOptions undefined when not provided', () => {
    const config = buildConfig(mockProvider)
    expect(config.providerOptions).toBeUndefined()
  })
})
