/**
 * Centralized Model Registry - Single source of truth for all model metadata.
 *
 * Model and provider data is loaded from models.json at the project root.
 * This module provides typed interfaces and lookup helpers.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LanguageModel } from 'ai'

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

/** Configuration for explicit model registry initialization. */
export interface ModelRegistryInit {
  /** Raw JSON string for the model registry. Takes priority over `file`. */
  json?: string
  /** Path to a models.json file. */
  file?: string
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

let _pendingConfig: ModelRegistryInit | null = null

/**
 * Explicitly configure how the model registry loads its data.
 *
 * Must be called **before** the first registry access (e.g. `getModelRegistry()`).
 * No-ops silently if the registry is already loaded or pending configuration.
 *
 * Priority chain when the registry loads:
 * 1. `initModelRegistry({ json })` — explicit JSON string
 * 2. `initModelRegistry({ file })` — explicit file path
 * 3. `process.env.MODELS_JSON` — env var fallback
 * 4. `process.env.MODELS_FILE` — env var fallback
 * 5. `./models.json` — hardcoded default
 */
export function initModelRegistry(config: ModelRegistryInit): void {
  if (_cache) {
    console.debug('[ai] initModelRegistry() called after registry already loaded — ignored.')
    return
  }
  if (_pendingConfig) {
    console.debug('[ai] initModelRegistry() called twice before registry load — ignored.')
    return
  }
  _pendingConfig = config
}

/**
 * Returns true if the registry has been loaded or is pending configuration.
 * Useful for callers that want to avoid redundant `initModelRegistry()` calls.
 */
export function isRegistryConfigured(): boolean {
  return _cache !== null || _pendingConfig !== null
}

function loadModelsJson(): ModelsJson {
  // Priority: pending config > env vars > default file
  let modelsJsonRaw = ''
  const searchedPaths: string[] = []

  if (_pendingConfig?.json) {
    modelsJsonRaw = _pendingConfig.json.trim()
  }

  if (!modelsJsonRaw && _pendingConfig?.file) {
    const filePath = resolve(process.cwd(), _pendingConfig.file)
    searchedPaths.push(filePath)
    if (existsSync(filePath)) {
      modelsJsonRaw = readFileSync(filePath, 'utf-8')
    }
  }

  if (!modelsJsonRaw) {
    const envJson = (process.env.MODELS_JSON ?? '').trim()
    if (envJson) {
      modelsJsonRaw = envJson
    }
  }

  if (!modelsJsonRaw) {
    const envFile = process.env.MODELS_FILE
    if (envFile) {
      const filePath = resolve(process.cwd(), envFile)
      searchedPaths.push(filePath)
      if (existsSync(filePath)) {
        modelsJsonRaw = readFileSync(filePath, 'utf-8')
      }
    }
  }

  if (!modelsJsonRaw) {
    const defaultPath = resolve(process.cwd(), './models.json')
    searchedPaths.push(defaultPath)
    if (existsSync(defaultPath)) {
      modelsJsonRaw = readFileSync(defaultPath, 'utf-8')
    }
  }

  if (!modelsJsonRaw) {
    const searched =
      searchedPaths.length > 0
        ? searchedPaths.map((p) => `  - ${p}`).join('\n')
        : '  (no path configured)'
    throw new Error(`models.json not found. Searched:\n${searched}`)
  }

  const modelsJson = JSON.parse(modelsJsonRaw)
  validateModelsJson(modelsJson)
  return modelsJson
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy singleton — loadModelsJson() runs on first use, not on import
// ─────────────────────────────────────────────────────────────────────────────

let _cache: ModelsJson | null = null

function getLoadedModels(): ModelsJson {
  if (!_cache) {
    _cache = loadModelsJson()
  }
  return _cache
}

const _resetCallbacks: Array<() => void> = []

/** Register a callback to run when the registry is reset. Used by downstream caches. */
export function _onRegistryReset(cb: () => void): void {
  _resetCallbacks.push(cb)
}

/** Reset the cached registry (for tests only). Also clears dependent caches. */
export function _resetRegistryCache(): void {
  _cache = null
  _pendingConfig = null
  for (const cb of _resetCallbacks) cb()
}

/** Get the centralized model registry. */
export function getModelRegistry(): readonly ModelConfig[] {
  return getLoadedModels().models
}

/** Get the provider registry. */
export function getProviderRegistry(): readonly ProviderConfig[] {
  return getLoadedModels().providers
}

/** Get the default provider from models.json. */
export function getDefaultProvider(): ProviderId {
  return getLoadedModels().defaultProvider
}

/** Lookup provider config by ID. Throws if not found. */
export function getProviderConfig(id: ProviderId): ProviderConfig {
  const cfg = getProviderRegistry().find((p) => p.id === id)
  if (!cfg) {
    throw new Error(`Unknown provider: ${id}`)
  }
  return cfg
}

/** Default pricing for unknown models — conservative estimate to avoid masking spend */
const DEFAULT_PRICING: ModelPricing = { input: 1.0, output: 4.0, image: 0.5 }

/** Get pricing for a model. Returns conservative defaults for unknown models. */
export function getModelPricing(modelId: string): ModelPricing {
  const model = getModel(modelId)
  if (model?.pricing) return model.pricing
  return DEFAULT_PRICING
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Lookup model by ID. Returns undefined if not found. */
export function getModel(modelId: string): ModelConfig | undefined {
  return getModelRegistry().find((m) => m.id === modelId)
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
  return getModelRegistry().filter((m) => m.provider === provider)
}

/** Resolve alias to model ID. Returns input if not an alias. */
export function resolveModelAlias(provider: ProviderId, aliasOrId: string): string {
  const model = getModelRegistry().find(
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

/** Extract a model identifier string for observability purposes. */
export function getModelIdentifier(model: LanguageModel): string {
  if (typeof model === 'string') return model
  if ('modelId' in model && typeof model.modelId === 'string') return model.modelId
  return 'unknown'
}
