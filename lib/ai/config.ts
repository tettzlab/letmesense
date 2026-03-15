import {
  getModelRegistry,
  getModelsByProvider,
  getProviderRegistry,
  type ModelPricing,
  type ProviderId,
  resolveModelAlias,
} from './models.js'

// Derive PROVIDERS from registry (lazy)
export function getProviders(): { id: ProviderId; name: string }[] {
  return getProviderRegistry().map((p) => ({ id: p.id, name: p.name }))
}

// Re-export model types for convenience
export type {
  ModelCapabilities,
  ModelConfig,
  ModelPricing,
  ModelRegistryInit,
  ProviderConfig,
  ProviderId,
  ReasoningConfig,
  TemperatureConfig,
  TokenizerEncoding,
} from './models.js'
export {
  _resetRegistryCache,
  getDefaultProvider,
  getModel,
  getModelOrThrow,
  getModelPricing,
  getModelRegistry,
  getModelsByProvider,
  getProviderConfig,
  getProviderRegistry,
  initModelRegistry,
  modelSupportsPdf,
  modelSupportsVision,
} from './models.js'
// Re-export provider options
export { buildProviderOptions } from './providerOptions.js'
// Re-export resolve types
export type { ResolvedModel, ResolveModelErrorCode } from './resolve.js'
export { ResolveModelError, resolveModel, resolveModel as resolveModelSpec } from './resolve.js'

// ============================================================================
// LLM Provider Types
// ============================================================================

/** Cost estimate for a formatting operation */
export interface CostEstimate {
  inputTokens: number
  outputTokens: number
  imageTokens: number
  totalCost: number
  model: string
  provider: ProviderId
}

/** Configuration for an LLM provider */
export interface LlmConfig {
  /** Provider name */
  provider: ProviderId
  /** Model ID (uses provider default if not specified) */
  model?: string
  /** API key (uses env var if not specified) */
  apiKey?: string
  /** Base URL for API (for Ollama or custom endpoints) */
  baseUrl?: string
  /** Request timeout in ms */
  timeout?: number
  /** Max retries on failure */
  maxRetries?: number
  /** Provider-specific options (reasoning effort, etc.) */
  providerOptions?: ProviderOptions
}

/** JSON-compatible value for provider options */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/** Provider options type for Vercel AI SDK providerOptions */
export type ProviderOptions = Record<string, Record<string, JsonValue>>

/** LLM request for formatting content */
export interface FormatRequest {
  /** Extracted text to format */
  text: string
  /** Base64-encoded image data (for vision mode) */
  image?: string
  /** PDF bytes (for PDF-capable providers like Anthropic/Google) */
  pdf?: Buffer
  /** Context for template variables (provider-agnostic) */
  context?: Record<string, unknown>
  /** Custom prompt template (overrides default) */
  promptTemplate?: string
  /** Additional template variables */
  promptVariables?: Record<string, string>
}

// ============================================================================
// Token Usage Types (for detailed tracking)
// ============================================================================

/** Input token breakdown details */
export interface TokenInputDetails {
  /** Tokens read from cache (e.g., Anthropic cache_read_input_tokens, OpenAI cached_tokens) */
  cached?: number
  /** Tokens written to cache (Anthropic cache_creation_input_tokens) */
  cacheCreation?: number
  /** Non-cached tokens (computed: inputTokens - cached) */
  uncached?: number
}

/** Output token breakdown details */
export interface TokenOutputDetails {
  /** Regular text output tokens */
  text?: number
  /** Reasoning/thinking tokens (OpenAI o-series reasoning_tokens, Google thoughtsTokenCount) */
  reasoning?: number
}

/** Detailed token usage structure */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  /** Total tokens if reported by provider (may differ from sum due to special tokens) */
  totalTokens?: number

  /** Input token breakdown (optional, provider-dependent) */
  inputDetails?: TokenInputDetails

  /** Output token breakdown (optional, provider-dependent) */
  outputDetails?: TokenOutputDetails
}

/** Cost breakdown structure */
export interface CostBreakdown {
  /** Total calculated cost (USD) */
  total: number
  /** Input token cost */
  input?: number
  /** Output token cost */
  output?: number
  /** Cached token cost (with discount applied) */
  cached?: number
  /** Reasoning token cost (if separate pricing) */
  reasoning?: number
}

/** LLM response from formatting */
export interface FormatResponse {
  /** Formatted content */
  content: string
  /** Token usage (detailed structure) */
  usage: TokenUsage
  /** Reason the model stopped generating (stop, length, content_filter, etc.) */
  finishReason?: string
  /** Raw response metadata for debugging (provider-specific) */
  rawMeta?: Record<string, unknown>
}

/** Abstract LLM provider interface */
export interface LlmProvider {
  /** Provider name */
  readonly name: ProviderId

  /** Default model for text formatting */
  readonly defaultModel: string

  /** Default model for vision formatting */
  readonly defaultVisionModel: string

  /** Check if provider is available (has API key, etc.) */
  isAvailable(): boolean

  /** Get pricing for a model */
  getPricing(model: string): ModelPricing

  /** Format content */
  format(request: FormatRequest, config: LlmConfig): Promise<FormatResponse>

  /** Format content with streaming */
  formatStream(
    request: FormatRequest,
    config: LlmConfig,
    onChunk: (chunk: string) => void,
  ): Promise<FormatResponse>
}

/** Result of provider auto-detection */
export interface DetectedProvider {
  provider: ProviderId
  reason: string
}

// Derive MODELS from registry (lazy)
export function getModels(): Record<
  ProviderId,
  readonly { readonly id: string; readonly name: string }[]
> {
  return {
    openai: getModelsByProvider('openai').map((m) => ({ id: m.id, name: m.name })),
    anthropic: getModelsByProvider('anthropic').map((m) => ({ id: m.id, name: m.name })),
    google: getModelsByProvider('google').map((m) => ({ id: m.id, name: m.name })),
    ollama: getModelsByProvider('ollama').map((m) => ({ id: m.id, name: m.name })),
    azure: getModelsByProvider('azure').map((m) => ({ id: m.id, name: m.name })),
  }
}

// Free tier models derived from registry (lazy)
export function getFreeTierModels(): readonly string[] {
  return getModelRegistry()
    .filter((m) => m.freeTier)
    .map((m) => m.id)
}

export function isFreeTierModel(modelId: string): boolean {
  return getFreeTierModels().includes(modelId)
}

// Free tier models organized by provider (lazy)
export function getFreeTierModelsByProvider(): Readonly<
  Record<ProviderId, readonly { readonly id: string; readonly name: string }[]>
> {
  const models = getModels()
  return {
    openai: models.openai.filter((m) => isFreeTierModel(m.id)),
    anthropic: models.anthropic.filter((m) => isFreeTierModel(m.id)),
    google: models.google.filter((m) => isFreeTierModel(m.id)),
    ollama: models.ollama.filter((m) => isFreeTierModel(m.id)),
    azure: models.azure.filter((m) => isFreeTierModel(m.id)),
  }
}

// Response token limits
export const TOKEN_LIMITS = {
  guest: 750,
  authenticated: 4096,
  slide: 4000,
} as const

// Flattened model list for unified dropdown UI
export interface FlatModel {
  id: string // model ID (e.g., 'gpt-5-nano')
  name: string // display name (e.g., 'GPT-5 Nano')
  provider: ProviderId // provider ID (e.g., 'openai')
  providerName: string // provider display name (e.g., 'OpenAI')
  isFreeTier: boolean // whether this model is available to guests
}

export function getFlatModels(): FlatModel[] {
  const providers = getProviders()
  const models = getModels()
  return providers.flatMap((provider) =>
    models[provider.id].map((model) => ({
      id: model.id,
      name: model.name,
      provider: provider.id,
      providerName: provider.name,
      isFreeTier: isFreeTierModel(model.id),
    })),
  )
}

// Helper for CLI help text
export function getProviderChoices(): string {
  return getProviders()
    .map((p) => p.id)
    .join(' | ')
}

// Derive MODEL_ALIASES from registry (lazy)
function buildAliasMap(provider: ProviderId): Record<string, string> {
  return Object.fromEntries(
    getModelRegistry()
      .filter((m) => m.provider === provider)
      .flatMap((m) => (m.aliases ?? []).map((alias) => [alias, m.id])),
  )
}

export function getModelAliases(): Record<ProviderId, Record<string, string>> {
  return {
    openai: buildAliasMap('openai'),
    anthropic: buildAliasMap('anthropic'),
    google: buildAliasMap('google'),
    ollama: buildAliasMap('ollama'),
    azure: buildAliasMap('azure'),
  }
}

// Parsed model specification
export interface ParsedModelSpec {
  provider: ProviderId
  modelId: string
  effort: string | null
}

// Error class for parse failures
export class ParseModelSpecError extends Error {
  constructor(
    message: string,
    public code:
      | 'INVALID_FORMAT'
      | 'UNKNOWN_PROVIDER'
      | 'MISSING_MODEL'
      | 'INVALID_EFFORT'
      | 'EFFORT_NOT_SUPPORTED',
  ) {
    super(message)
    this.name = 'ParseModelSpecError'
  }
}

// Parse "provider:model" or "provider:model:effort" format into structured spec
export function parseModelSpec(spec: string): ParsedModelSpec {
  const trimmed = spec.trim()
  const parts = trimmed.split(':')

  // Must have 2 or 3 segments
  if (parts.length < 2 || parts.length > 3) {
    throw new ParseModelSpecError(
      `Invalid model format "${spec}". Expected "provider:model" or "provider:model:effort" (e.g., "openai:gpt-5-mini", "openai:mini:medium")`,
      'INVALID_FORMAT',
    )
  }

  const [providerPart, modelPart, effortPart] = parts

  // Validate provider
  const validProviders = getProviders().map((p) => p.id) as readonly string[]
  if (!validProviders.includes(providerPart)) {
    throw new ParseModelSpecError(
      `Unknown provider "${providerPart}". Valid providers: ${getProviderChoices()}`,
      'UNKNOWN_PROVIDER',
    )
  }

  const provider = providerPart as ProviderId

  // Check for empty model
  if (!modelPart) {
    const example = getModels()[provider][0]?.id ?? '<model-id>'
    throw new ParseModelSpecError(
      `Missing model ID after "${provider}:". Example: "${provider}:${example}"`,
      'MISSING_MODEL',
    )
  }

  // Resolve alias if exists, otherwise use raw model ID
  const resolvedModel = resolveModelAlias(provider, modelPart)

  // Validate effort if provided
  const effort: string | null = effortPart ?? null
  if (effort) {
    const model = getModelRegistry().find((m) => m.id === resolvedModel)
    if (model && !model.capabilities?.reasoning) {
      throw new ParseModelSpecError(
        `Model "${resolvedModel}" does not support reasoning effort. Remove ":${effort}" from "${spec}".`,
        'EFFORT_NOT_SUPPORTED',
      )
    }
    if (model?.capabilities?.reasoning && !model.capabilities.reasoning.levels.includes(effort)) {
      throw new ParseModelSpecError(
        `Invalid effort "${effort}" for model "${resolvedModel}". Valid levels: ${model.capabilities.reasoning.levels.join(', ')}`,
        'INVALID_EFFORT',
      )
    }
  }

  return { provider, modelId: resolvedModel, effort }
}

// Generate example CLI commands for help text
export function getModelSpecExamples(): string {
  const models = getModels()
  return getProviders()
    .map((p) => {
      const providerModels = models[p.id]
      const firstModel = providerModels[0]?.id ?? '<model-id>'
      return `  --model ${p.id}:${firstModel}`
    })
    .join('\n')
}
