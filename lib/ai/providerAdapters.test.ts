import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawUsageInfo } from './providerAdapters.js'
import {
  anthropicAdapter,
  googleAdapter,
  ollamaAdapter,
  openaiAdapter,
} from './providerAdapters.js'

// Mock fetch for Ollama availability checks
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('openaiAdapter', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  describe('extractUsage', () => {
    it('extracts basic usage', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }
      const result = openaiAdapter.extractUsage(info)
      expect(result.inputTokens).toBe(100)
      expect(result.outputTokens).toBe(50)
      expect(result.totalTokens).toBe(150)
    })

    it('extracts cached tokens from providerMetadata', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 100, outputTokens: 50 },
        providerMetadata: { openai: { cachedPromptTokens: 30 } },
      }
      const result = openaiAdapter.extractUsage(info)
      expect(result.inputDetails?.cached).toBe(30)
      expect(result.inputDetails?.uncached).toBe(70)
    })

    it('extracts reasoning tokens from providerMetadata', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 100, outputTokens: 80 },
        providerMetadata: { openai: { reasoningTokens: 20 } },
      }
      const result = openaiAdapter.extractUsage(info)
      expect(result.outputDetails?.reasoning).toBe(20)
      expect(result.outputDetails?.text).toBe(60)
    })

    it('falls back to raw usage for cached tokens', () => {
      const info: RawUsageInfo = {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          raw: { prompt_tokens_details: { cached_tokens: 25 } },
        },
      }
      const result = openaiAdapter.extractUsage(info)
      expect(result.inputDetails?.cached).toBe(25)
    })

    it('handles missing usage', () => {
      const result = openaiAdapter.extractUsage({})
      expect(result.inputTokens).toBe(0)
      expect(result.outputTokens).toBe(0)
    })
  })

  describe('isAvailable', () => {
    it('returns false without env var', () => {
      expect(openaiAdapter.isAvailable()).toBe(false)
    })

    it('returns true with env var', () => {
      process.env.OPENAI_API_KEY = 'test-key'
      expect(openaiAdapter.isAvailable()).toBe(true)
    })
  })
})

describe('anthropicAdapter', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  describe('extractUsage', () => {
    it('extracts cache creation and read tokens', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 200, outputTokens: 50 },
        providerMetadata: {
          anthropic: { cacheCreationInputTokens: 80, cacheReadInputTokens: 40 },
        },
      }
      const result = anthropicAdapter.extractUsage(info)
      expect(result.inputDetails?.cacheCreation).toBe(80)
      expect(result.inputDetails?.cached).toBe(40)
      expect(result.inputDetails?.uncached).toBe(80) // 200 - 80 - 40
    })

    it('falls back to raw usage', () => {
      const info: RawUsageInfo = {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          raw: { cache_creation_input_tokens: 30, cache_read_input_tokens: 20 },
        },
      }
      const result = anthropicAdapter.extractUsage(info)
      expect(result.inputDetails?.cacheCreation).toBe(30)
      expect(result.inputDetails?.cached).toBe(20)
    })

    it('handles no cache details', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 100, outputTokens: 50 },
      }
      const result = anthropicAdapter.extractUsage(info)
      expect(result.inputDetails).toBeUndefined()
    })
  })

  describe('isAvailable', () => {
    it('returns false without env var', () => {
      expect(anthropicAdapter.isAvailable()).toBe(false)
    })

    it('returns true with env var', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key'
      expect(anthropicAdapter.isAvailable()).toBe(true)
    })
  })
})

describe('googleAdapter', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
  })

  describe('extractUsage', () => {
    it('extracts cached content tokens', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 200, outputTokens: 50 },
        providerMetadata: { google: { cachedContentTokenCount: 60 } },
      }
      const result = googleAdapter.extractUsage(info)
      expect(result.inputDetails?.cached).toBe(60)
      expect(result.inputDetails?.uncached).toBe(140)
    })

    it('extracts thoughts tokens', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 100, outputTokens: 80 },
        providerMetadata: { google: { thoughtsTokenCount: 30 } },
      }
      const result = googleAdapter.extractUsage(info)
      expect(result.outputDetails?.reasoning).toBe(30)
      expect(result.outputDetails?.text).toBe(50)
    })

    it('falls back to raw usage', () => {
      const info: RawUsageInfo = {
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          raw: { cachedContentTokenCount: 20 },
        },
      }
      const result = googleAdapter.extractUsage(info)
      expect(result.inputDetails?.cached).toBe(20)
    })
  })

  describe('isAvailable', () => {
    it('returns false without env var', () => {
      expect(googleAdapter.isAvailable()).toBe(false)
    })

    it('returns true with GOOGLE_API_KEY', () => {
      process.env.GOOGLE_API_KEY = 'test-key'
      expect(googleAdapter.isAvailable()).toBe(true)
    })

    it('returns true with GOOGLE_GENERATIVE_AI_API_KEY', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key'
      expect(googleAdapter.isAvailable()).toBe(true)
    })
  })
})

describe('ollamaAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OLLAMA_HOST
    mockFetch.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('extractUsage', () => {
    it('extracts basic usage', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 100, outputTokens: 50 },
      }
      const result = ollamaAdapter.extractUsage(info)
      expect(result.inputTokens).toBe(100)
      expect(result.outputTokens).toBe(50)
    })

    it('handles missing usage', () => {
      const result = ollamaAdapter.extractUsage({})
      expect(result.inputTokens).toBe(0)
      expect(result.outputTokens).toBe(0)
    })

    it('does not extract detailed fields', () => {
      const info: RawUsageInfo = {
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }
      const result = ollamaAdapter.extractUsage(info)
      expect(result.totalTokens).toBeUndefined()
      expect(result.inputDetails).toBeUndefined()
    })
  })

  describe('isAvailable', () => {
    it('returns true always (no API key required)', () => {
      expect(ollamaAdapter.isAvailable()).toBe(true)
    })

    it('returns true with OLLAMA_HOST', () => {
      process.env.OLLAMA_HOST = 'http://localhost:11434'
      expect(ollamaAdapter.isAvailable()).toBe(true)
    })
  })

  // spanAttributes / beforeFormat are always defined for Ollama; extract for cleaner test calls
  const getAttrs = ollamaAdapter.spanAttributes as NonNullable<typeof ollamaAdapter.spanAttributes>
  const ping = ollamaAdapter.beforeFormat as NonNullable<typeof ollamaAdapter.beforeFormat>

  describe('spanAttributes', () => {
    it('returns default host', () => {
      expect(getAttrs({ provider: 'ollama' })).toEqual({ host: 'http://localhost:11434' })
    })

    it('uses config baseUrl', () => {
      expect(getAttrs({ provider: 'ollama', baseUrl: 'http://custom:8080' })).toEqual({
        host: 'http://custom:8080',
      })
    })

    it('uses OLLAMA_HOST env var', () => {
      process.env.OLLAMA_HOST = 'http://envhost:11434'
      expect(getAttrs({ provider: 'ollama' })).toEqual({ host: 'http://envhost:11434' })
    })
  })

  describe('beforeFormat', () => {
    it('succeeds when Ollama is running', async () => {
      mockFetch.mockResolvedValue({ ok: true })
      await expect(ping({ provider: 'ollama' })).resolves.toBeUndefined()
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.any(Object))
    })

    it('throws ProviderUnavailableError when not running', async () => {
      mockFetch.mockResolvedValue({ ok: false })
      const { ProviderUnavailableError } = await import('./errors.js')
      await expect(ping({ provider: 'ollama' })).rejects.toThrow(ProviderUnavailableError)
    })

    it('throws ProviderUnavailableError on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      const { ProviderUnavailableError } = await import('./errors.js')
      await expect(ping({ provider: 'ollama' })).rejects.toThrow(ProviderUnavailableError)
    })

    it('uses custom host from config', async () => {
      mockFetch.mockResolvedValue({ ok: true })
      await ping({ provider: 'ollama', baseUrl: 'http://custom:8080' })
      expect(mockFetch).toHaveBeenCalledWith('http://custom:8080/api/tags', expect.any(Object))
    })

    it('uses OLLAMA_HOST env var', async () => {
      process.env.OLLAMA_HOST = 'http://envhost:11434'
      mockFetch.mockResolvedValue({ ok: true })
      await ping({ provider: 'ollama' })
      expect(mockFetch).toHaveBeenCalledWith('http://envhost:11434/api/tags', expect.any(Object))
    })
  })
})
