/**
 * Register all LLM provider implementations.
 *
 * Call registerAllProviders() once at startup to make all providers available.
 */

import { createGenericProvider } from './genericProvider.js'
import { registerProvider } from './provider.js'
import {
  anthropicAdapter,
  azureAdapter,
  googleAdapter,
  ollamaAdapter,
  openaiAdapter,
} from './providerAdapters.js'

export function registerAllProviders(): void {
  registerProvider(createGenericProvider(openaiAdapter))
  registerProvider(createGenericProvider(anthropicAdapter))
  registerProvider(createGenericProvider(googleAdapter))
  registerProvider(createGenericProvider(ollamaAdapter))
  registerProvider(createGenericProvider(azureAdapter))
}
