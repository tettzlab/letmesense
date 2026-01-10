/**
 * Centralized Model Registry - Single source of truth for all model metadata.
 *
 * Model and provider data is loaded from models.json at the project root.
 * This module provides typed interfaces and lookup helpers.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Supported AI provider identifiers */
export type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama'

/**
 * Tokenizer encoding identifier.
 * Maps to specific tokenizer library and encoding.
 */
export type TokenizerEncoding =
  | 'cl100k_base' // GPT-4 (gpt-tokenizer)
  | 'o200k_base' // GPT-4o, o1, o3, GPT-5 (gpt-tokenizer)
  | 'claude' // Claude models (@lenml/tokenizer-claude)
  | 'gemini' // Gemini models (@lenml/tokenizer-gemini)
  | 'llama3' // Llama 3.x (llama3-tokenizer-js)
  | 'qwen2' // Qwen 2.x (use llama3 as approximation)

/** Model pricing per 1M tokens (USD) */
export interface ModelPricing {
  input: number
  output: number
  /** Image/vision pricing per 1M tokens, null if not supported */
  image: number | null
}

/** Temperature capability for a model */
export interface TemperatureConfig {
  min?: number
  max?: number
  default?: number
}

/** Reasoning effort capability for a model */
export interface ReasoningConfig {
  /** Canonical effort levels this model supports */
  levels: string[]
  /** Default effort level */
  default: string
}

/** Grouped model capabilities */
export interface ModelCapabilities {
  /** Whether model supports vision/images */
  vision?: boolean
  /** Whether model supports direct PDF input (no image conversion needed) */
  pdfInput?: boolean
  /** Temperature control. Absent = no temperature support. */
  temperature?: TemperatureConfig
  /** Reasoning effort. Absent = no reasoning support. */
  reasoning?: ReasoningConfig
}

/**
 * Complete model configuration.
 * Single source of truth for all model metadata.
 */
export interface ModelConfig {
  /** Unique model identifier (e.g., 'gpt-5-nano') */
  id: string
  /** Display name (e.g., 'GPT-5 Nano') */
  name: string
  /** Provider ID */
  provider: ProviderId
  /** Context window size in tokens (input + output) */
  contextWindow: number
  /** Maximum output tokens per response */
  maxOutputTokens: number
  /** Tokenizer encoding to use for token counting */
  encoding: TokenizerEncoding
  /** Model aliases for CLI shortcuts */
  aliases?: string[]
  /** Whether available in free tier */
  freeTier?: boolean
  /** Pricing per 1M tokens (USD). Falls back to provider default if omitted. */
  pricing?: ModelPricing
  /** Model capabilities (vision, pdfInput, temperature, reasoning) */
  capabilities?: ModelCapabilities
}

/** Provider-level configuration */
export interface ProviderConfig {
  id: ProviderId
  name: string
  defaultModel: string
  defaultVisionModel: string
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Loading
// ─────────────────────────────────────────────────────────────────────────────

interface ModelsJson {
  defaultProvider: ProviderId
  providers: ProviderConfig[]
  models: ModelConfig[]
}

const VALID_PROVIDER_IDS = new Set(['openai', 'anthropic', 'google', 'ollama'])
const VALID_ENCODINGS = new Set([
  'cl100k_base',
  'o200k_base',
  'claude',
  'gemini',
  'llama3',
  'qwen2',
])

function validateModelsJson(data: unknown): asserts data is ModelsJson {
  if (!data || typeof data !== 'object') {
    throw new Error('models.json must be a JSON object')
  }

  const obj = data as Record<string, unknown>

  // Validate defaultProvider
  if (typeof obj.defaultProvider !== 'string' || !VALID_PROVIDER_IDS.has(obj.defaultProvider)) {
    throw new Error(
      `models.json must have a valid "defaultProvider" field. Valid: ${[...VALID_PROVIDER_IDS].join(', ')}`,
    )
  }

  // Validate providers
  if (!Array.isArray(obj.providers) || obj.providers.length === 0) {
    throw new Error('models.json must have a non-empty "providers" array')
  }
  for (const p of obj.providers) {
    if (!p || typeof p !== 'object') {
      throw new Error('Each provider must be an object')
    }
    const prov = p as Record<string, unknown>
    for (const field of ['id', 'name', 'defaultModel', 'defaultVisionModel']) {
      if (typeof prov[field] !== 'string') {
        throw new Error(`Provider "${prov.id ?? '?'}" missing required string field "${field}"`)
      }
    }
    if (!VALID_PROVIDER_IDS.has(prov.id as string)) {
      throw new Error(
        `Unknown provider id "${prov.id}". Valid: ${[...VALID_PROVIDER_IDS].join(', ')}`,
      )
    }
  }

  // Validate models
  if (!Array.isArray(obj.models) || obj.models.length === 0) {
    throw new Error('models.json must have a non-empty "models" array')
  }
  for (const m of obj.models) {
    if (!m || typeof m !== 'object') {
      throw new Error('Each model must be an object')
    }
    const model = m as Record<string, unknown>
    for (const field of ['id', 'name', 'provider', 'encoding']) {
      if (typeof model[field] !== 'string') {
        throw new Error(`Model "${model.id ?? '?'}" missing required string field "${field}"`)
      }
    }
    for (const field of ['contextWindow', 'maxOutputTokens']) {
      if (typeof model[field] !== 'number') {
        throw new Error(`Model "${model.id}" missing required number field "${field}"`)
      }
    }
    if (!VALID_ENCODINGS.has(model.encoding as string)) {
      throw new Error(
        `Model "${model.id}" has invalid encoding "${model.encoding}". Valid: ${[...VALID_ENCODINGS].join(', ')}`,
      )
    }
  }
}

function loadModelsJson(): ModelsJson {
  const jsonPath = resolve(import.meta.dirname, '../../models.json')
  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  validateModelsJson(raw)
  return raw
}

const loaded = loadModelsJson()

/**
 * Centralized model registry.
 * Single source of truth for all supported models.
 */
export const MODEL_REGISTRY: readonly ModelConfig[] = loaded.models

// ─────────────────────────────────────────────────────────────────────────────
// Provider Registry
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDER_REGISTRY: readonly ProviderConfig[] = loaded.providers

/** Default provider from models.json */
export const DEFAULT_PROVIDER: ProviderId = loaded.defaultProvider

/** Lookup provider config by ID. Throws if not found. */
export function getProviderConfig(id: ProviderId): ProviderConfig {
  const cfg = PROVIDER_REGISTRY.find((p) => p.id === id)
  if (!cfg) {
    throw new Error(`Unknown provider: ${id}`)
  }
  return cfg
}

/** Get pricing for a model. Returns zeros for unknown models. */
export function getModelPricing(modelId: string): ModelPricing {
  const model = getModel(modelId)
  if (model?.pricing) return model.pricing
  return { input: 0, output: 0, image: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Lookup model by ID. Returns undefined if not found. */
export function getModel(modelId: string): ModelConfig | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId)
}

/** Lookup model by ID, throw if not found. */
export function getModelOrThrow(modelId: string): ModelConfig {
  const model = getModel(modelId)
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`)
  }
  return model
}

/** Get all models for a provider. */
export function getModelsByProvider(provider: ProviderId): ModelConfig[] {
  return MODEL_REGISTRY.filter((m) => m.provider === provider)
}

/** Resolve alias to model ID. Returns input if not an alias. */
export function resolveModelAlias(provider: ProviderId, aliasOrId: string): string {
  const model = MODEL_REGISTRY.find(
    (m) => m.provider === provider && m.aliases?.includes(aliasOrId),
  )
  return model?.id ?? aliasOrId
}

/** Check if a model supports direct PDF input. */
export function modelSupportsPdf(modelId: string): boolean {
  return getModel(modelId)?.capabilities?.pdfInput === true
}

/** Check if a model supports vision/images. */
export function modelSupportsVision(modelId: string): boolean {
  return getModel(modelId)?.capabilities?.vision === true
}

/** Get default encoding for unknown models based on provider. */
export function getDefaultEncoding(provider: ProviderId): TokenizerEncoding {
  const cfg = getProviderConfig(provider)
  const model = getModel(cfg.defaultModel)
  return model?.encoding ?? 'o200k_base'
}
