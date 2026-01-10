import type { LanguageModel } from 'ai'

/**
 * Extract a model identifier string for observability purposes.
 */
export function getModelIdentifier(model: LanguageModel): string {
  if (typeof model === 'string') return model
  if ('modelId' in model && typeof model.modelId === 'string') return model.modelId
  return 'unknown'
}
