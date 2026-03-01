/**
 * LLM provider abstraction and auto-detection
 */

import { obs } from '../observability/index.js'
import type { DetectedProvider, LlmConfig, LlmProvider, ProviderId } from './types.js'

const { logger } = obs('ai.provider')

/** Registry of available providers */
const providers = new Map<ProviderId, LlmProvider>()

/** Register a provider implementation */
export function registerProvider(provider: LlmProvider): void {
  providers.set(provider.name, provider)
}

/** Get a provider by name */
export function getProvider(name: ProviderId): LlmProvider | undefined {
  return providers.get(name)
}

/** Get all registered providers */
export function getAllProviders(): LlmProvider[] {
  return Array.from(providers.values())
}

/**
 * Auto-detect the best available provider
 * Priority: OpenAI → Anthropic → Google → Ollama
 */
export function detectProvider(): DetectedProvider | null {
  const priority: ProviderId[] = ['openai', 'anthropic', 'google', 'ollama']

  for (const name of priority) {
    const provider = providers.get(name)
    if (provider?.isAvailable()) {
      logger.debug({ provider: name }, 'Auto-detected LLM provider')
      return {
        provider: name,
        reason: `${name} API key found`,
      }
    }
  }

  logger.debug('No LLM provider detected from environment')
  return null
}

/**
 * Resolve provider from config or auto-detect
 */
export function resolveProvider(config?: Partial<LlmConfig>): LlmProvider {
  if (config?.provider) {
    const provider = providers.get(config.provider)
    if (!provider) {
      throw new Error(
        `Unknown LLM provider: ${config.provider}\n\n` +
          `Available providers: openai, anthropic, google, ollama`,
      )
    }
    if (!provider.isAvailable()) {
      const envHints: Record<string, string> = {
        openai: 'export OPENAI_API_KEY="sk-..."',
        anthropic: 'export ANTHROPIC_API_KEY="sk-ant-..."',
        google: 'export GOOGLE_GENERATIVE_AI_API_KEY="..."',
        ollama:
          'export OLLAMA_HOST="http://localhost:11434"  # then: ollama serve && ollama pull llama3.2',
      }
      const hint = envHints[config.provider] ?? 'Check provider documentation'
      throw new Error(
        `Provider '${config.provider}' is not configured.\n\n` + `To configure:\n  ${hint}`,
      )
    }
    return provider
  }

  const detected = detectProvider()
  if (!detected) {
    throw new Error(
      `No LLM provider available.\n\n` +
        `Configure at least one provider via environment variables:\n\n` +
        `  OpenAI:     export OPENAI_API_KEY="sk-..."\n` +
        `  Anthropic:  export ANTHROPIC_API_KEY="sk-ant-..."\n` +
        `  Google:     export GOOGLE_GENERATIVE_AI_API_KEY="..."\n` +
        `  Ollama:     ollama serve  (runs locally, no key needed)\n\n` +
        `Or specify a provider and model explicitly with --model <provider>:<model>`,
    )
  }

  const provider = providers.get(detected.provider)
  if (!provider) {
    // This should never happen since detectProvider checks availability
    throw new Error(`Provider ${detected.provider} not found in registry`)
  }

  logger.debug({ provider: detected.provider, reason: detected.reason }, 'Resolved LLM provider')
  return provider
}

/**
 * Resolve model from config or use provider default
 */
export function resolveModelId(
  provider: LlmProvider,
  config?: Partial<LlmConfig>,
  vision?: boolean,
): string {
  if (config?.model) {
    return config.model
  }
  return vision ? provider.defaultVisionModel : provider.defaultModel
}

/**
 * Build full LlmConfig from partial config and defaults
 */
export function buildConfig(
  provider: LlmProvider,
  partial?: Partial<LlmConfig>,
  vision?: boolean,
): LlmConfig {
  return {
    provider: provider.name,
    model: resolveModelId(provider, partial, vision),
    apiKey: partial?.apiKey,
    baseUrl: partial?.baseUrl,
    timeout: partial?.timeout ?? 60_000,
    maxRetries: partial?.maxRetries ?? 3,
    providerOptions: partial?.providerOptions,
  }
}
