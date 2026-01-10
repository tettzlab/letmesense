/**
 * Model resolution - parses model specs and returns fully-populated config.
 *
 * Supports 1/2/3-segment shorthand:
 *   - "gpt-5-mini" (bare model, requires providerId param)
 *   - "openai:mini" (provider:modelOrAlias)
 *   - "openai:mini:medium" (provider:modelOrAlias:effort)
 */

import {
  getDefaultEncoding,
  getModel,
  getModelPricing,
  type ModelConfig,
  type ModelPricing,
  PROVIDER_REGISTRY,
  type ProviderId,
  resolveModelAlias,
  type TemperatureConfig,
  type TokenizerEncoding,
} from './models.js'

/** Fully resolved model configuration with all defaults filled in */
export interface ResolvedModel {
  provider: ProviderId
  modelId: string
  modelConfig: ModelConfig | null
  pricing: ModelPricing
  encoding: TokenizerEncoding
  contextWindow: number
  maxOutputTokens: number
  /** Resolved effort level, null if model doesn't support reasoning */
  effort: string | null
  temperature: TemperatureConfig
}

/** Error codes for model resolution failures */
export type ResolveModelErrorCode =
  | 'INVALID_FORMAT'
  | 'UNKNOWN_PROVIDER'
  | 'MISSING_MODEL'
  | 'INVALID_EFFORT'
  | 'EFFORT_NOT_SUPPORTED'

export class ResolveModelError extends Error {
  constructor(
    message: string,
    public code: ResolveModelErrorCode,
  ) {
    super(message)
    this.name = 'ResolveModelError'
  }
}

const VALID_PROVIDERS = new Set(PROVIDER_REGISTRY.map((p) => p.id))

/**
 * Resolve a model spec string into a fully-populated ResolvedModel.
 *
 * @param spec - Model spec: "model", "provider:model", or "provider:model:effort"
 * @param providerId - Required when spec is a bare model ID (1 segment)
 */
export function resolveModel(spec: string, providerId?: ProviderId): ResolvedModel {
  const trimmed = spec.trim()
  const parts = trimmed.split(':')

  let provider: ProviderId
  let modelPart: string
  let effortPart: string | undefined

  if (parts.length === 1) {
    // Bare model ID — provider param required
    if (!providerId) {
      throw new ResolveModelError(
        `Bare model ID "${trimmed}" requires a provider. Use "provider:model" format.`,
        'INVALID_FORMAT',
      )
    }
    provider = providerId
    modelPart = parts[0]
  } else if (parts.length === 2) {
    provider = parts[0] as ProviderId
    modelPart = parts[1]
  } else if (parts.length === 3) {
    provider = parts[0] as ProviderId
    modelPart = parts[1]
    effortPart = parts[2]
  } else {
    throw new ResolveModelError(
      `Invalid model format "${spec}". Expected "provider:model" or "provider:model:effort".`,
      'INVALID_FORMAT',
    )
  }

  // Validate provider
  if (!VALID_PROVIDERS.has(provider)) {
    throw new ResolveModelError(
      `Unknown provider "${provider}". Valid providers: ${[...VALID_PROVIDERS].join(', ')}`,
      'UNKNOWN_PROVIDER',
    )
  }

  // Validate model part is non-empty
  if (!modelPart) {
    throw new ResolveModelError(`Missing model ID in "${spec}".`, 'MISSING_MODEL')
  }

  // Resolve alias
  const modelId = resolveModelAlias(provider, modelPart)

  // Look up model config (may be null for unknown/custom models)
  const modelConfig = getModel(modelId) ?? null

  // Validate effort
  let effort: string | null = null
  if (effortPart) {
    if (!modelConfig?.capabilities?.reasoning) {
      throw new ResolveModelError(
        `Model "${modelId}" does not support reasoning effort. Remove the effort segment from "${spec}".`,
        'EFFORT_NOT_SUPPORTED',
      )
    }
    if (!modelConfig.capabilities.reasoning.levels.includes(effortPart)) {
      throw new ResolveModelError(
        `Invalid effort "${effortPart}" for model "${modelId}". Valid levels: ${modelConfig.capabilities.reasoning.levels.join(', ')}`,
        'INVALID_EFFORT',
      )
    }
    effort = effortPart
  } else if (modelConfig?.capabilities?.reasoning) {
    effort = modelConfig.capabilities.reasoning.default
  }

  // Fill defaults
  const pricing = getModelPricing(modelId)
  const encoding = modelConfig?.encoding ?? getDefaultEncoding(provider)
  const contextWindow = modelConfig?.contextWindow ?? 128_000
  const maxOutputTokens = modelConfig?.maxOutputTokens ?? 8192
  const temperature: TemperatureConfig = modelConfig?.capabilities?.temperature ?? {
    min: 0,
    max: 2,
    default: 1,
  }

  return {
    provider,
    modelId,
    modelConfig,
    pricing,
    encoding,
    contextWindow,
    maxOutputTokens,
    effort,
    temperature,
  }
}
