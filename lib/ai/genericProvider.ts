/**
 * Generic LLM provider implementation driven by ProviderAdapter hooks.
 *
 * Consolidates the shared format/formatStream logic that was duplicated
 * across openai.ts, anthropic.ts, google.ts, and ollama.ts.
 */

import { generateText, streamText } from 'ai'
import { obs, SemanticAttributes } from '../observability/index.js'
import { ProviderUnavailableError, parseApiError } from './errors.js'
import { getModelPricing, getProviderConfig, modelSupportsPdf } from './models.js'
import {
  CONTINUITY_PROMPT_PREFIX,
  DEFAULT_TEXT_PROMPT,
  DEFAULT_VISION_PROMPT,
  substituteVariables,
} from './prompts.js'
import type { ProviderAdapter } from './providerAdapters.js'
import { AbortRetryError, withRetry } from './retry.js'
import { addGuardrail, wrapUntrustedContent } from './sanitize.js'
import { Metrics } from './signals.js'
import { calculateMaxOutputTokens } from './tokens.js'
import type {
  FormatRequest,
  FormatResponse,
  LlmConfig,
  LlmProvider,
  ModelPricing,
  PageContext,
} from './types.js'

/**
 * Calculate cost from token usage and pricing
 */
function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
): { inputCost: number; outputCost: number; totalCost: number } {
  const inputCost = (inputTokens * pricing.input) / 1_000_000
  const outputCost = (outputTokens * pricing.output) / 1_000_000
  const totalCost = inputCost + outputCost
  return { inputCost, outputCost, totalCost }
}

/**
 * Build system prompt and user messages for chat completion.
 *
 * Separates base instructions (system role) from document content
 * (user role) to mitigate prompt injection via malicious documents.
 * Document text is wrapped in randomized delimiters.
 */
function buildMessages(request: FormatRequest, model: string, vision: boolean) {
  const promptTemplate =
    request.promptTemplate ?? (vision ? DEFAULT_VISION_PROMPT : DEFAULT_TEXT_PROMPT)

  // Build the system prompt: substitute all vars except {text},
  // then strip the {text} placeholder (it goes in the user message)
  const ctx = request.context ?? {}
  const pageCtx = ctx as PageContext

  let systemBase = promptTemplate
  // Add continuity prefix for multi-page documents
  if (pageCtx.page > 1 && pageCtx.previousTail) {
    systemBase = CONTINUITY_PROMPT_PREFIX + systemBase
  }

  const systemWithVars = substituteVariables(systemBase, ctx, request.promptVariables, {
    excludeKeys: ['text'],
  })
  const system = addGuardrail(
    systemWithVars
      .replace(/\n*(?:Extracted )?[Tt]ext:\n*\{text\}\s*$/i, '')
      .replaceAll('{text}', '')
      .trim(),
  )

  // Build user content: wrap document text in randomized delimiters
  const textContent = pageCtx.text ?? request.text ?? ''
  const userText = textContent
    ? wrapUntrustedContent(textContent, 'document_text')
    : 'Format this document.'

  // PDF-direct mode (for providers/models that support it)
  if (vision && request.pdf && modelSupportsPdf(model)) {
    return {
      system,
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: userText },
            {
              type: 'file' as const,
              data: request.pdf.toString('base64'),
              mediaType: 'application/pdf' as const,
            },
          ],
        },
      ],
    }
  }

  // Vision request with image
  if (vision && request.image) {
    return {
      system,
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: userText },
            // Vercel AI SDK image part expects Buffer, not base64 string
            { type: 'image' as const, image: Buffer.from(request.image, 'base64') },
          ],
        },
      ],
    }
  }

  // Text-only request
  return { system, messages: [{ role: 'user' as const, content: userText }] }
}

/**
 * Create a generic LlmProvider from a ProviderAdapter.
 */
export function createGenericProvider(adapter: ProviderAdapter): LlmProvider {
  const providerCfg = getProviderConfig(adapter.id)
  const providerId = adapter.id
  const providerLabel = providerId.charAt(0).toUpperCase() + providerId.slice(1)

  return {
    name: providerId,
    defaultModel: providerCfg.defaultModel,
    defaultVisionModel: providerCfg.defaultVisionModel,

    isAvailable(): boolean {
      return adapter.isAvailable()
    },

    getPricing(model: string): ModelPricing {
      return getModelPricing(model)
    },

    async format(request: FormatRequest, config: LlmConfig): Promise<FormatResponse> {
      const { tracer, metrics, logger } = obs(`ai.${providerId}`)

      return tracer.startSpan(`ai.${providerId}.format`, async (span) => {
        // beforeFormat hook (e.g. Ollama ping)
        if (adapter.beforeFormat) {
          try {
            await adapter.beforeFormat(config)
          } catch (error) {
            if (error instanceof ProviderUnavailableError) {
              metrics
                .counter(Metrics.REQUEST_COUNT)
                .add(1, { provider: providerId, status: 'unavailable' })
            }
            throw error
          }
        }

        // PDF warning for non-PDF-capable models
        if (request.pdf && !modelSupportsPdf(config.model ?? this.defaultModel)) {
          logger.warn(
            { provider: providerId },
            `PDF input provided but ${providerLabel} does not support direct PDF input. The PDF will be ignored. Use image input instead or switch to Anthropic/Google.`,
          )
        }

        const model = config.model ?? this.defaultModel
        const vision = !!(request.image || (request.pdf && modelSupportsPdf(model)))

        span.setAttribute(SemanticAttributes.MODEL, model)
        span.setAttribute('vision', vision)
        span.setAttribute(SemanticAttributes.PROVIDER, providerId)
        if (adapter.spanAttributes) {
          for (const [k, v] of Object.entries(adapter.spanAttributes(config))) {
            span.setAttribute(k, v)
          }
        }

        const { system, messages } = buildMessages(request, model, vision)
        const maxOutputTokens = calculateMaxOutputTokens(request.text ?? '', model)

        const retryResult = await withRetry(
          async () =>
            generateText({
              model: adapter.createLanguageModel(config, model),
              system,
              messages,
              maxOutputTokens,
              providerOptions: config.providerOptions,
            }),
          { maxRetries: config.maxRetries ?? 3 },
        )

        if (!retryResult.success || !retryResult.result) {
          metrics
            .counter(Metrics.REQUEST_COUNT)
            .add(1, { provider: providerId, model, status: 'error' })
          throw parseApiError(
            retryResult.error ?? new Error('Unknown error after retry exhaustion'),
            providerLabel,
          )
        }

        const result = retryResult.result
        const finishReason = result.finishReason ?? 'unknown'

        // Extract detailed token usage via adapter
        const usage = adapter.extractUsage({
          usage: result.usage,
          providerMetadata: result.providerMetadata,
        })
        const { inputTokens, outputTokens } = usage

        // Debug logging for empty output
        if (!result.text || result.text.length === 0) {
          logger.warn(
            {
              model,
              finishReason,
              inputTokens,
              outputTokens,
              textLength: result.text?.length ?? 0,
              hasResponse: !!result.response,
            },
            `${providerLabel} returned empty text content`,
          )
        }

        // Calculate and record cost
        const pricing = this.getPricing(model)
        const { inputCost, outputCost, totalCost } = calculateCost(
          inputTokens,
          outputTokens,
          pricing,
        )

        span.setAttribute(SemanticAttributes.INPUT_TOKENS, inputTokens)
        span.setAttribute(SemanticAttributes.OUTPUT_TOKENS, outputTokens)
        span.setAttribute(SemanticAttributes.ATTEMPTS, retryResult.attempts)
        span.setAttribute(SemanticAttributes.COST_INPUT_USD, inputCost)
        span.setAttribute(SemanticAttributes.COST_OUTPUT_USD, outputCost)
        span.setAttribute(SemanticAttributes.COST_TOTAL_USD, totalCost)
        metrics
          .counter(Metrics.REQUEST_COUNT)
          .add(1, { provider: providerId, model, status: 'success' })
        metrics
          .histogram(Metrics.TOKEN_INPUT_COUNT)
          .record(inputTokens, { provider: providerId, model })
        metrics
          .histogram(Metrics.TOKEN_OUTPUT_COUNT)
          .record(outputTokens, { provider: providerId, model })
        metrics.histogram(Metrics.COST_USD).record(totalCost, { provider: providerId, model })
        metrics.counter(Metrics.COST_TOTAL_USD).add(totalCost, { provider: providerId, model })
        logger.debug(
          {
            model,
            inputTokens,
            outputTokens,
            attempts: retryResult.attempts,
            costUsd: totalCost,
          },
          `${providerLabel} format completed`,
        )

        return {
          content: result.text,
          usage,
          finishReason,
          rawMeta: {
            providerMetadata: result.providerMetadata,
            responseId: result.response?.id,
            modelId: result.response?.modelId,
            timestamp: result.response?.timestamp?.toISOString(),
            rawUsage: result.usage?.raw,
          },
        }
      })
    },

    async formatStream(
      request: FormatRequest,
      config: LlmConfig,
      onChunk: (chunk: string) => void,
    ): Promise<FormatResponse> {
      const { tracer, metrics, logger } = obs(`ai.${providerId}`)

      return tracer.startSpan(`ai.${providerId}.formatStream`, async (span) => {
        // beforeFormat hook (e.g. Ollama ping)
        if (adapter.beforeFormat) {
          try {
            await adapter.beforeFormat(config)
          } catch (error) {
            if (error instanceof ProviderUnavailableError) {
              metrics
                .counter(Metrics.REQUEST_COUNT)
                .add(1, { provider: providerId, status: 'unavailable', streaming: 'true' })
            }
            throw error
          }
        }

        // PDF warning for non-PDF-capable models
        if (request.pdf && !modelSupportsPdf(config.model ?? this.defaultModel)) {
          logger.warn(
            { provider: providerId },
            `PDF input provided but ${providerLabel} does not support direct PDF input. The PDF will be ignored. Use image input instead or switch to Anthropic/Google.`,
          )
        }

        const model = config.model ?? this.defaultModel
        const vision = !!(request.image || (request.pdf && modelSupportsPdf(model)))

        span.setAttribute(SemanticAttributes.MODEL, model)
        span.setAttribute('vision', vision)
        span.setAttribute(SemanticAttributes.PROVIDER, providerId)
        span.setAttribute(SemanticAttributes.STREAMING, true)
        if (adapter.spanAttributes) {
          for (const [k, v] of Object.entries(adapter.spanAttributes(config))) {
            span.setAttribute(k, v)
          }
        }

        const { system, messages } = buildMessages(request, model, vision)
        const maxOutputTokens = calculateMaxOutputTokens(request.text ?? '', model)

        // For streaming, retry only if no chunks have been emitted yet.
        // Once onChunk has sent data to the caller, retrying would produce
        // duplicate content since there's no mechanism to signal a reset.
        const retryResult = await withRetry(
          async () => {
            const result = streamText({
              model: adapter.createLanguageModel(config, model),
              system,
              messages,
              maxOutputTokens,
              providerOptions: config.providerOptions,
            })

            let fullContent = ''
            let chunksEmitted = false

            try {
              for await (const chunk of result.textStream) {
                fullContent += chunk
                onChunk(chunk)
                chunksEmitted = true
              }
            } catch (streamError) {
              if (chunksEmitted) {
                // Already sent partial output to caller — retrying would
                // duplicate it. Surface the error immediately.
                throw new AbortRetryError(streamError)
              }
              throw streamError
            }

            // Get final usage and finish reason after stream completes
            const [rawUsage, finishReason, response, providerMetadata] = await Promise.all([
              result.usage,
              result.finishReason,
              result.response,
              result.providerMetadata,
            ])

            // Extract detailed token usage via adapter
            const usage = adapter.extractUsage({
              usage: rawUsage,
              providerMetadata,
            })

            return {
              content: fullContent,
              usage,
              finishReason: finishReason ?? 'unknown',
              rawMeta: {
                providerMetadata,
                responseId: response?.id,
                modelId: response?.modelId,
                timestamp: response?.timestamp?.toISOString(),
                rawUsage: rawUsage?.raw,
              },
            }
          },
          { maxRetries: config.maxRetries ?? 3 },
        )

        if (!retryResult.success || !retryResult.result) {
          metrics
            .counter(Metrics.REQUEST_COUNT)
            .add(1, { provider: providerId, model, status: 'error', streaming: 'true' })
          throw parseApiError(
            retryResult.error ?? new Error('Unknown error after retry exhaustion'),
            providerLabel,
          )
        }

        const { inputTokens, outputTokens } = retryResult.result.usage

        // Debug logging for empty output
        if (!retryResult.result.content || retryResult.result.content.length === 0) {
          logger.warn(
            {
              model,
              finishReason: retryResult.result.finishReason,
              inputTokens,
              outputTokens,
              contentLength: retryResult.result.content?.length ?? 0,
              streaming: true,
            },
            `${providerLabel} streaming returned empty text content`,
          )
        }

        // Calculate and record cost
        const pricing = this.getPricing(model)
        const { inputCost, outputCost, totalCost } = calculateCost(
          inputTokens,
          outputTokens,
          pricing,
        )

        span.setAttribute(SemanticAttributes.INPUT_TOKENS, inputTokens)
        span.setAttribute(SemanticAttributes.OUTPUT_TOKENS, outputTokens)
        span.setAttribute(SemanticAttributes.ATTEMPTS, retryResult.attempts)
        span.setAttribute(SemanticAttributes.COST_INPUT_USD, inputCost)
        span.setAttribute(SemanticAttributes.COST_OUTPUT_USD, outputCost)
        span.setAttribute(SemanticAttributes.COST_TOTAL_USD, totalCost)
        metrics
          .counter(Metrics.REQUEST_COUNT)
          .add(1, { provider: providerId, model, status: 'success', streaming: 'true' })
        metrics
          .histogram(Metrics.TOKEN_INPUT_COUNT)
          .record(inputTokens, { provider: providerId, model })
        metrics
          .histogram(Metrics.TOKEN_OUTPUT_COUNT)
          .record(outputTokens, { provider: providerId, model })
        metrics.histogram(Metrics.COST_USD).record(totalCost, { provider: providerId, model })
        metrics.counter(Metrics.COST_TOTAL_USD).add(totalCost, { provider: providerId, model })
        logger.debug(
          { model, inputTokens, outputTokens, streaming: true, costUsd: totalCost },
          `${providerLabel} stream completed`,
        )

        return retryResult.result
      })
    },
  }
}
