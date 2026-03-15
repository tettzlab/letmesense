import { anthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { ollama } from 'ollama-ai-provider'
import type { ParsedModelSpec } from './config.js'

// Re-export LanguageModel for consumers
export type { LanguageModel }

export function createModel(spec: ParsedModelSpec): LanguageModel {
  switch (spec.provider) {
    case 'openai':
      // Use Responses API (default in AI SDK 5+)
      return openai.responses(spec.modelId)
    case 'anthropic':
      return anthropic(spec.modelId)
    case 'google':
      return google(spec.modelId)
    case 'ollama':
      // ollama-ai-provider returns LanguageModelV1, cast to LanguageModel for compatibility
      return ollama(spec.modelId) as unknown as LanguageModel
    case 'azure': {
      const baseURL = process.env.AZURE_OPENAI_ENDPOINT
      const resourceName =
        process.env.AZURE_RESOURCE_NAME ??
        (baseURL ? new URL(baseURL).hostname.split('.')[0] : undefined)
      const azure = createAzure({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        resourceName,
      })
      return azure(spec.modelId)
    }
  }
}
