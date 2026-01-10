/**
 * Provider adapter implementations for the generic provider framework.
 *
 * Each adapter encapsulates provider-specific SDK creation and usage extraction.
 * All shared logic (retry, metrics, cost, messages) lives in genericProvider.ts.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { ApiKeyError, ProviderUnavailableError } from './errors.js'
import type { LlmConfig, ProviderId, TokenUsage } from './types.js'

/** Raw usage info passed to extractUsage */
export interface RawUsageInfo {
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    raw?: Record<string, unknown>
  }
  providerMetadata?: Record<string, unknown>
}

/** Provider adapter interface */
export interface ProviderAdapter {
  id: ProviderId
  createLanguageModel(config: LlmConfig, model: string): LanguageModel
  extractUsage(info: RawUsageInfo): TokenUsage
  isAvailable(): boolean
  beforeFormat?(config: LlmConfig): Promise<void>
  /** Extra span attributes to set on format/formatStream spans */
  spanAttributes?(config: LlmConfig): Record<string, string>
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Adapter
// ─────────────────────────────────────────────────────────────────────────────

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',

  createLanguageModel(config: LlmConfig, model: string): LanguageModel {
    const key = config.apiKey ?? process.env.OPENAI_API_KEY
    if (!key) throw new ApiKeyError('OpenAI')
    return createOpenAI({ apiKey: key, baseURL: config.baseUrl }).responses(model)
  },

  extractUsage({ usage, providerMetadata }: RawUsageInfo): TokenUsage {
    const inputTokens = usage?.inputTokens ?? 0
    const outputTokens = usage?.outputTokens ?? 0
    const totalTokens = usage?.totalTokens

    const result: TokenUsage = { inputTokens, outputTokens }
    if (totalTokens !== undefined) result.totalTokens = totalTokens

    const openaiMeta = providerMetadata?.openai as
      | { cachedPromptTokens?: number; reasoningTokens?: number }
      | undefined

    const rawUsage = usage?.raw as
      | {
          prompt_tokens_details?: { cached_tokens?: number }
          completion_tokens_details?: { reasoning_tokens?: number }
        }
      | undefined

    const cachedTokens =
      openaiMeta?.cachedPromptTokens ?? rawUsage?.prompt_tokens_details?.cached_tokens
    if (cachedTokens !== undefined && cachedTokens > 0) {
      result.inputDetails = {
        cached: cachedTokens,
        uncached: inputTokens - cachedTokens,
      }
    }

    const reasoningTokens =
      openaiMeta?.reasoningTokens ?? rawUsage?.completion_tokens_details?.reasoning_tokens
    if (reasoningTokens !== undefined && reasoningTokens > 0) {
      result.outputDetails = {
        reasoning: reasoningTokens,
        text: outputTokens - reasoningTokens,
      }
    }

    return result
  },

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic Adapter
// ─────────────────────────────────────────────────────────────────────────────

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',

  createLanguageModel(config: LlmConfig, model: string): LanguageModel {
    const key = config.apiKey ?? process.env.ANTHROPIC_API_KEY
    if (!key) throw new ApiKeyError('Anthropic')
    return createAnthropic({ apiKey: key, baseURL: config.baseUrl })(model)
  },

  extractUsage({ usage, providerMetadata }: RawUsageInfo): TokenUsage {
    const inputTokens = usage?.inputTokens ?? 0
    const outputTokens = usage?.outputTokens ?? 0
    const totalTokens = usage?.totalTokens

    const result: TokenUsage = { inputTokens, outputTokens }
    if (totalTokens !== undefined) result.totalTokens = totalTokens

    const anthropicMeta = providerMetadata?.anthropic as
      | { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
      | undefined

    const rawUsage = usage?.raw as
      | { cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
      | undefined

    const cacheCreation =
      anthropicMeta?.cacheCreationInputTokens ?? rawUsage?.cache_creation_input_tokens
    const cacheRead = anthropicMeta?.cacheReadInputTokens ?? rawUsage?.cache_read_input_tokens

    if (
      (cacheCreation !== undefined && cacheCreation > 0) ||
      (cacheRead !== undefined && cacheRead > 0)
    ) {
      result.inputDetails = {}

      if (cacheCreation !== undefined && cacheCreation > 0) {
        result.inputDetails.cacheCreation = cacheCreation
      }
      if (cacheRead !== undefined && cacheRead > 0) {
        result.inputDetails.cached = cacheRead
      }

      const cachedTotal = (cacheCreation ?? 0) + (cacheRead ?? 0)
      if (cachedTotal > 0 && inputTokens > cachedTotal) {
        result.inputDetails.uncached = inputTokens - cachedTotal
      }
    }

    return result
  },

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Adapter
// ─────────────────────────────────────────────────────────────────────────────

export const googleAdapter: ProviderAdapter = {
  id: 'google',

  createLanguageModel(config: LlmConfig, model: string): LanguageModel {
    const key =
      config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!key) throw new ApiKeyError('Google')
    return createGoogleGenerativeAI({ apiKey: key, baseURL: config.baseUrl })(model)
  },

  extractUsage({ usage, providerMetadata }: RawUsageInfo): TokenUsage {
    const inputTokens = usage?.inputTokens ?? 0
    const outputTokens = usage?.outputTokens ?? 0
    const totalTokens = usage?.totalTokens

    const result: TokenUsage = { inputTokens, outputTokens }
    if (totalTokens !== undefined) result.totalTokens = totalTokens

    const googleMeta = providerMetadata?.google as
      | { cachedContentTokenCount?: number; thoughtsTokenCount?: number }
      | undefined

    const rawUsage = usage?.raw as
      | { cachedContentTokenCount?: number; thoughtsTokenCount?: number }
      | undefined

    const cachedTokens = googleMeta?.cachedContentTokenCount ?? rawUsage?.cachedContentTokenCount
    if (cachedTokens !== undefined && cachedTokens > 0) {
      result.inputDetails = {
        cached: cachedTokens,
        uncached: inputTokens - cachedTokens,
      }
    }

    const thoughtsTokens = googleMeta?.thoughtsTokenCount ?? rawUsage?.thoughtsTokenCount
    if (thoughtsTokens !== undefined && thoughtsTokens > 0) {
      result.outputDetails = {
        reasoning: thoughtsTokens,
        text: outputTokens - thoughtsTokens,
      }
    }

    return result
  },

  isAvailable(): boolean {
    return !!(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama Adapter
// ─────────────────────────────────────────────────────────────────────────────

/** Default Ollama host */
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434'

/** Availability check timeout (5 seconds) */
const AVAILABILITY_TIMEOUT_MS = 5000

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',

  createLanguageModel(config: LlmConfig, model: string): LanguageModel {
    const host = config.baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST
    return createOpenAI({ baseURL: `${host}/v1`, apiKey: 'ollama' })(model)
  },

  extractUsage({ usage }: RawUsageInfo): TokenUsage {
    return {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    }
  },

  isAvailable(): boolean {
    // Ollama doesn't require an API key; defaults to localhost.
    // The beforeFormat() hook does a proper connectivity check.
    return true
  },

  spanAttributes(config: LlmConfig): Record<string, string> {
    return { host: config.baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST }
  },

  async beforeFormat(config: LlmConfig): Promise<void> {
    const host = config.baseUrl ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST
    try {
      const response = await fetch(`${host}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new ProviderUnavailableError('Ollama', `Not running at ${host}`)
      }
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error
      throw new ProviderUnavailableError('Ollama', `Not running at ${host}`)
    }
  },
}
