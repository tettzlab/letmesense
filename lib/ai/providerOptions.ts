/**
 * Provider-specific SDK parameter mapping for reasoning effort.
 *
 * Maps canonical effort levels to Vercel AI SDK `providerOptions`.
 */

import type { JsonValue } from './config.js'
import type { ResolvedModel } from './resolve.js'

/**
 * Map canonical effort level to Anthropic thinking budget tokens.
 * Uses a proportion of maxOutputTokens based on effort level.
 */
function effortToBudget(resolved: ResolvedModel): number {
  const max = resolved.maxOutputTokens
  const levels = resolved.modelConfig?.capabilities?.reasoning?.levels ?? []
  const idx = levels.indexOf(resolved.effort ?? '')
  const ratio = (idx + 1) / levels.length
  // Minimum 1024 tokens, scale up to 80% of max
  return Math.max(1024, Math.floor(max * ratio * 0.8))
}

/**
 * Map canonical effort level to Google thinkingLevel.
 * Google uses: NONE | MINIMAL | LOW | MEDIUM | HIGH
 */
function effortToGoogleLevel(effort: string): string {
  // Google levels match our canonical levels (case-insensitive on their end)
  return effort.toUpperCase()
}

/**
 * Build provider-specific `providerOptions` for Vercel AI SDK.
 * Returns undefined if no reasoning effort is applicable.
 */
export function buildProviderOptions(
  resolved: ResolvedModel,
): Record<string, Record<string, JsonValue>> | undefined {
  if (!resolved.effort || resolved.effort === 'none') return undefined

  switch (resolved.provider) {
    case 'openai':
    case 'azure':
      return { openai: { reasoningEffort: resolved.effort } }
    case 'anthropic':
      return {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens: effortToBudget(resolved) },
        },
      }
    case 'google':
      return {
        google: {
          thinkingConfig: { thinkingLevel: effortToGoogleLevel(resolved.effort) },
        },
      }
    default:
      return undefined
  }
}
