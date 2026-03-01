import type { LanguageModel } from 'ai'
import { obs } from '../observability/index.js'
import { getModels, type ProviderId, parseModelSpec } from './config.js'
import { createModel } from './createModel.js'

const { logger } = obs('ai.registry')

/**
 * Check if a model ID is known for the given provider.
 */
function isKnownModel(provider: ProviderId, modelId: string): boolean {
  const knownModels = getModels()[provider]
  return knownModels.some((m) => m.id === modelId)
}

// Registry facade that parses model specs and creates models
export const registry = {
  /**
   * Create a language model from a model spec string.
   *
   * @param modelId - Model spec in "provider:model" format (e.g., "openai:gpt-5-mini")
   * @returns LanguageModel instance
   *
   * @example
   * const model = registry.languageModel('anthropic:sonnet')
   */
  languageModel(modelId: `${ProviderId}:${string}`): LanguageModel {
    const spec = parseModelSpec(modelId)

    // Warn if model is not in our known list (might be typo or new model)
    if (!isKnownModel(spec.provider, spec.modelId)) {
      const known = getModels()
        [spec.provider].map((m) => m.id)
        .join(', ')
      logger.warn(
        { provider: spec.provider, modelId: spec.modelId },
        `Unknown model "${spec.modelId}" for provider "${spec.provider}". Known models: ${known}`,
      )
    }

    return createModel(spec)
  },
}
