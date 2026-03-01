/**
 * Vision analysis module for image-to-text using LLMs.
 *
 * Provides both streaming (for CLI) and non-streaming (for agent tool) APIs.
 * Uses Vercel AI SDK's generateText and streamText functions.
 */

import type { LanguageModel } from 'ai'
import { generateText, streamText } from 'ai'
import {
  type ModelPricing,
  type ProviderId,
  type ProviderOptions,
  parseModelSpec,
} from '../ai/config.js'
import { estimateImageTokens, estimateTextTokens } from '../ai/cost.js'
import { createModel } from '../ai/createModel.js'
import { calculateEntryCost, createJournalEntry } from '../ai/journal.js'
import { getProvider } from '../ai/provider.js'
import { buildProviderOptions } from '../ai/providerOptions.js'
import { resolveModel as resolveModelFull } from '../ai/resolve.js'
import type { JournalCallback } from '../ai/types.js'
import { obs, SemanticAttributes } from '../observability/index.js'
import type { ImageContext } from '../pipeline/types.js'
import { Metrics, Spans } from './signals.js'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Vision analysis timeout - 60 seconds */
export const VISION_ANALYSIS_TIMEOUT_MS = 60_000

/** Maximum vision output chars */
export const VISION_MAX_OUTPUT_CHARS = 50_000

/** Default vision prompt */
export const VISION_DEFAULT_PROMPT =
  'Describe this image in detail. Include relevant text, objects, colors, layout, and any notable features. Format your response as markdown.'

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the full vision prompt with optional context.
 * Includes previous page output (for continuity) and extracted text (for accuracy).
 */
function buildVisionPromptWithContext(
  basePrompt: string,
  extractedText?: string,
  previousPageOutput?: string,
): string {
  const parts: string[] = [basePrompt]

  // Add previous page context for continuity
  if (previousPageOutput) {
    parts.push(`
---

**Previous page output (for continuity):**

${previousPageOutput}

Maintain continuity with the previous page. If content continues (lists, tables, sections, sentences), preserve that continuity in your formatting.`)
  }

  // Add extracted text for accuracy
  if (extractedText) {
    parts.push(`
---

**Extracted text from document:**

${extractedText}`)
  }

  return parts.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VisionAnalysisOptions {
  /** Base64-encoded image data */
  imageData: string
  /** MIME type (e.g., 'image/png', 'image/jpeg') */
  mimeType: string
  /** Custom analysis prompt (default: detailed description) */
  prompt?: string
  /** Vision-capable model instance */
  model: LanguageModel
  /** Max output characters (default: 50000) */
  maxOutputChars?: number
  /** Experiment name for journaling */
  experiment?: string
  /** Journal callback for logging LLM calls */
  onJournal?: JournalCallback
  /** File path of the image (for context) */
  filePath?: string
  /** Image width in pixels (for context) */
  width?: number
  /** Image height in pixels (for context) */
  height?: number
  /** Extracted text from the document (for born-digital PDFs, Office docs, etc.) */
  extractedText?: string
  /** Complete output from the previous page's LLM call (for continuity across pages) */
  previousPageOutput?: string
  /** Provider-specific options (reasoning effort, etc.) */
  providerOptions?: ProviderOptions
}

export interface VisionAnalysisSuccess {
  ok: true
  /** Markdown description of the image */
  description: string
  /** Whether output was truncated */
  truncated: boolean
  /** Model identifier used */
  model: string
}

export interface VisionAnalysisError {
  ok: false
  error: string
  code: 'MODEL_ERROR' | 'TIMEOUT' | 'INVALID_INPUT' | 'NO_API_KEY'
}

export type VisionResult = VisionAnalysisSuccess | VisionAnalysisError

export interface CreateVisionModelResult {
  model: LanguageModel | null
  providerOptions?: ProviderOptions
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// API Key Validation
// ─────────────────────────────────────────────────────────────────────────────

function getApiKeyEnvVar(provider: ProviderId): string | null {
  switch (provider) {
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'anthropic':
      return 'ANTHROPIC_API_KEY'
    case 'google':
      return 'GOOGLE_GENERATIVE_AI_API_KEY'
    case 'ollama':
      return null // Ollama is local, no API key needed
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a vision model from a spec string.
 * Validates API key availability before creating the model.
 */
export function createVisionModel(modelSpec: string): CreateVisionModelResult {
  try {
    const spec = parseModelSpec(modelSpec)

    // Check for API key
    const keyEnvVar = getApiKeyEnvVar(spec.provider)
    if (keyEnvVar && !process.env[keyEnvVar]) {
      return {
        model: null,
        error: `Missing API key: Set ${keyEnvVar} environment variable`,
      }
    }

    // Build providerOptions from effort if present
    let providerOptions: ProviderOptions | undefined
    if (spec.effort) {
      const resolved = resolveModelFull(`${spec.provider}:${spec.modelId}:${spec.effort}`)
      providerOptions = buildProviderOptions(resolved)
    }

    return { model: createModel(spec), providerOptions }
  } catch (err) {
    return {
      model: null,
      error: err instanceof Error ? err.message : 'Failed to create model',
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Default pricing for unknown models */
const DEFAULT_PRICING: ModelPricing = { input: 0.15, output: 0.6, image: null }

/**
 * Get provider name and pricing from a model ID.
 * Attempts to parse provider:model format, falls back to defaults.
 */
function getModelPricing(modelId: string): { providerName: string; pricing: ModelPricing } {
  const { logger } = obs('images.vision')

  // Try to parse provider:model format
  const colonIndex = modelId.indexOf(':')
  if (colonIndex > 0) {
    const providerName = modelId.slice(0, colonIndex) as ProviderId
    const provider = getProvider(providerName)
    if (provider) {
      const modelName = modelId.slice(colonIndex + 1)
      return { providerName, pricing: provider.getPricing(modelName) }
    }
    logger.warn(
      { provider: providerName, model: modelId },
      'Provider not registered, using default pricing. Ensure provider modules are imported.',
    )
  }

  // Try common provider prefixes
  const providerPrefixes: Array<{ prefix: string; provider: ProviderId }> = [
    { prefix: 'gpt-', provider: 'openai' },
    { prefix: 'o1-', provider: 'openai' },
    { prefix: 'claude-', provider: 'anthropic' },
    { prefix: 'gemini-', provider: 'google' },
    { prefix: 'llama', provider: 'ollama' },
  ]

  for (const { prefix, provider: providerName } of providerPrefixes) {
    if (modelId.startsWith(prefix)) {
      const provider = getProvider(providerName)
      if (provider) {
        return { providerName, pricing: provider.getPricing(modelId) }
      }
      logger.warn(
        { provider: providerName, model: modelId },
        'Provider not registered, using default pricing. Ensure provider modules are imported.',
      )
    }
  }

  return { providerName: 'unknown', pricing: DEFAULT_PRICING }
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-Streaming Analysis (for agent tool)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze image using vision LLM (non-streaming).
 * For use in agent tool where complete response is needed.
 */
export async function analyzeImage(opts: VisionAnalysisOptions): Promise<VisionResult> {
  const { tracer, metrics } = obs('images')

  return tracer.startSpan(Spans.ANALYZE, async (span) => {
    const {
      imageData,
      mimeType,
      prompt = VISION_DEFAULT_PROMPT,
      model,
      maxOutputChars = VISION_MAX_OUTPUT_CHARS,
      experiment,
      onJournal,
      filePath,
      width,
      height,
      extractedText,
      previousPageOutput,
      providerOptions,
    } = opts

    span.setAttribute(SemanticAttributes.STREAMING, false)
    span.setAttribute('mimeType', mimeType)
    if (filePath) span.setAttribute('filePath', filePath)
    if (extractedText) span.setAttribute('hasExtractedText', true)
    if (previousPageOutput) span.setAttribute('hasPreviousPageOutput', true)

    // Validate inputs
    if (!imageData) {
      metrics.counter(Metrics.ANALYSIS_COUNT).add(1, { status: 'failure', streaming: 'false' })
      return { ok: false, error: 'Image data is required', code: 'INVALID_INPUT' }
    }

    // Build the full prompt with context
    const fullPrompt = buildVisionPromptWithContext(prompt, extractedText, previousPageOutput)

    // Measure timing for journaling
    const startTime = performance.now()

    try {
      const result = await Promise.race([
        generateText({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: fullPrompt },
                { type: 'image', image: `data:${mimeType};base64,${imageData}` },
              ],
            },
          ],
          maxOutputTokens: 4096,
          providerOptions,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Vision analysis timed out')),
            VISION_ANALYSIS_TIMEOUT_MS,
          ),
        ),
      ])

      const durationMs = Math.round(performance.now() - startTime)
      const fullText = result.text ?? ''
      const description = fullText.slice(0, maxOutputChars)
      const truncated = fullText.length > maxOutputChars

      // Record metrics
      metrics.counter(Metrics.ANALYSIS_COUNT).add(1, { status: 'success', streaming: 'false' })
      metrics.histogram(Metrics.ANALYSIS_DURATION_MS).record(durationMs)

      // Journal the LLM call if experiment is enabled
      if (experiment && onJournal) {
        const modelId = getModelId(model)
        const { providerName, pricing } = getModelPricing(modelId)

        // Get usage from result or estimate
        const inputTokens = result.usage?.inputTokens ?? estimateTextTokens(fullPrompt)
        const outputTokens = result.usage?.outputTokens ?? estimateTextTokens(fullText)
        const totalTokens = result.usage?.totalTokens
        // Image tokens are included in the inputTokens from the provider
        void estimateImageTokens(width ?? 0, height ?? 0)

        // Build detailed token usage
        const rawUsage = (result.usage as { raw?: Record<string, unknown> } | undefined)?.raw
        const tokens = {
          inputTokens,
          outputTokens,
          totalTokens,
          raw: rawUsage,
        }
        const cost = calculateEntryCost(tokens, pricing)

        // Build image context (include extracted text for born-digital docs)
        const context: ImageContext = {
          filePath: filePath ?? 'unknown',
          width: width ?? 0,
          height: height ?? 0,
          mimeType,
          text: extractedText ?? '',
        }

        // Build raw metadata
        const rawMeta = {
          providerMetadata: result.providerMetadata,
          responseId: result.response?.id,
          modelId: result.response?.modelId,
          timestamp: result.response?.timestamp?.toISOString(),
          rawUsage,
        }

        const entry = createJournalEntry({
          experiment,
          provider: providerName,
          model: modelId,
          promptTemplate: prompt,
          prompt: fullPrompt,
          context,
          hasImage: true,
          hasPdf: false,
          output: fullText,
          tokens,
          cost,
          durationMs,
          finishReason: result.finishReason,
          rawMeta,
          imageData,
          imageMimeType: mimeType,
        })

        await onJournal(entry)
      }

      return {
        ok: true,
        description,
        truncated,
        model: getModelId(model),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      span.recordException(err instanceof Error ? err : new Error(message))
      span.setError(message)
      metrics.counter(Metrics.ANALYSIS_COUNT).add(1, { status: 'failure', streaming: 'false' })

      if (message.includes('timed out')) {
        return { ok: false, error: message, code: 'TIMEOUT' }
      }
      if (
        message.includes('API key') ||
        message.includes('authentication') ||
        message.includes('401')
      ) {
        return { ok: false, error: message, code: 'NO_API_KEY' }
      }
      return { ok: false, error: message, code: 'MODEL_ERROR' }
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Analysis (for CLI)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze image with streaming (for CLI).
 * Yields text chunks as they arrive from the model.
 * Journals after stream completes if experiment/onJournal are provided.
 */
export async function* analyzeImageStreaming(
  opts: VisionAnalysisOptions,
): AsyncGenerator<string, void, unknown> {
  const { metrics } = obs('images')

  const {
    imageData,
    mimeType,
    prompt = VISION_DEFAULT_PROMPT,
    model,
    experiment,
    onJournal,
    filePath,
    width,
    height,
    extractedText,
    previousPageOutput,
    providerOptions,
  } = opts

  // Build the full prompt with context
  const fullPrompt = buildVisionPromptWithContext(prompt, extractedText, previousPageOutput)

  // Measure timing for journaling
  const startTime = performance.now()
  const chunks: string[] = []

  const streamResult = streamText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: fullPrompt },
          { type: 'image', image: `data:${mimeType};base64,${imageData}` },
        ],
      },
    ],
    maxOutputTokens: 4096,
    providerOptions,
  })

  for await (const chunk of streamResult.textStream) {
    chunks.push(chunk)
    yield chunk
  }

  // Record metrics after stream completes
  const durationMs = Math.round(performance.now() - startTime)
  metrics.counter(Metrics.ANALYSIS_COUNT).add(1, { status: 'success', streaming: 'true' })
  metrics.histogram(Metrics.ANALYSIS_DURATION_MS).record(durationMs)

  // Journal after stream completes if experiment is enabled
  if (experiment && onJournal) {
    const fullText = chunks.join('')
    const modelId = getModelId(model)
    const { providerName, pricing } = getModelPricing(modelId)

    // Get actual usage from stream result, fall back to estimates
    const sdkUsage = await streamResult.usage
    const finishReason = await streamResult.finishReason
    const response = await streamResult.response
    const providerMetadata = await streamResult.providerMetadata

    const inputTokens = sdkUsage?.inputTokens ?? estimateTextTokens(fullPrompt)
    const outputTokens = sdkUsage?.outputTokens ?? estimateTextTokens(fullText)
    const totalTokens = sdkUsage?.totalTokens
    // Image tokens are included in the inputTokens from the provider
    void estimateImageTokens(width ?? 0, height ?? 0)

    // Build detailed token usage
    const rawUsage = (sdkUsage as { raw?: Record<string, unknown> } | undefined)?.raw
    const tokens = {
      inputTokens,
      outputTokens,
      totalTokens,
      raw: rawUsage,
    }
    const cost = calculateEntryCost(tokens, pricing)

    // Build image context (include extracted text for born-digital docs)
    const context: ImageContext = {
      filePath: filePath ?? 'unknown',
      width: width ?? 0,
      height: height ?? 0,
      mimeType,
      text: extractedText ?? '',
    }

    // Build raw metadata
    const rawMeta = {
      providerMetadata,
      responseId: response?.id,
      modelId: response?.modelId,
      timestamp: response?.timestamp?.toISOString(),
      rawUsage,
    }

    const entry = createJournalEntry({
      experiment,
      provider: providerName,
      model: modelId,
      promptTemplate: prompt,
      prompt: fullPrompt,
      context,
      hasImage: true,
      hasPdf: false,
      output: fullText,
      tokens,
      cost,
      durationMs,
      finishReason,
      rawMeta,
      imageData,
      imageMimeType: mimeType,
    })

    await onJournal(entry)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function getModelId(model: LanguageModel): string {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object' && 'modelId' in model) {
    return String(model.modelId)
  }
  return 'unknown'
}
