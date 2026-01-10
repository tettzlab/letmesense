/**
 * AI stream wrappers with retry logic.
 *
 * Provides resilient wrappers for AI SDK's streamText and generateText
 * with automatic retry for transient failures.
 *
 * NOTE: Retry only handles pre-stream errors (connection, auth, initial rate limit).
 * Mid-stream errors (rate limit after partial response) are not retried as they
 * would require buffering and replaying, which adds complexity.
 */

import { generateText, streamText } from 'ai'
import { obs } from '../observability/index.js'
import { DEFAULT_RETRY_CONFIG, type RetryConfig, type RetryResult, withRetry } from './retry.js'

const { logger } = obs('ai.stream')

/**
 * Simplified retry options for stream/generate functions.
 */
export interface StreamRetryOptions {
  /** Max retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs?: number
}

type StreamTextParams = Parameters<typeof streamText>[0]
type StreamTextResult = ReturnType<typeof streamText>
type GenerateTextParams = Parameters<typeof generateText>[0]
type GenerateTextResult = Awaited<ReturnType<typeof generateText>>

/**
 * Wrap streamText with retry logic for pre-stream errors.
 *
 * Returns a RetryResult containing the stream on success.
 * The caller can then use result.result.toUIMessageStreamResponse() etc.
 *
 * @warning Mid-stream errors (rate limits after partial response) are NOT retried.
 * Only initial connection/validation errors are handled. This is because retrying
 * mid-stream would require buffering and replaying partial responses.
 *
 * @param params - streamText parameters (model, messages, etc.)
 * @param options - Optional retry configuration overrides
 * @returns RetryResult containing the stream on success
 *
 * @example
 * const retryResult = await streamTextWithRetry({ model, messages })
 * if (!retryResult.success) {
 *   return apiError(c, ErrorCode.AI_ERROR, retryResult.error?.message, 500)
 * }
 * return retryResult.result.toUIMessageStreamResponse()
 */
export async function streamTextWithRetry(
  params: StreamTextParams,
  options?: StreamRetryOptions,
): Promise<RetryResult<StreamTextResult>> {
  const retryConfig: Partial<RetryConfig> = {
    maxRetries: options?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
    initialDelayMs: options?.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
  }

  return withRetry(
    async () => {
      // streamText returns immediately with a stream object.
      // Only synchronous errors (validation, config) are caught here.
      // Mid-stream errors (rate limits, network) occur during consumption
      // and are NOT retried - this is a documented limitation.
      return streamText(params)
    },
    retryConfig,
    (attempt, delay, error, category) => {
      logger.warn(
        {
          attempt,
          delay,
          error: error.message,
          category,
        },
        'Retrying streamText',
      )
    },
  )
}

/**
 * Wrap generateText with retry logic.
 *
 * Unlike streamText, generateText awaits the full response,
 * so all errors are caught and can be retried.
 *
 * @param params - generateText parameters (model, messages, etc.)
 * @param options - Optional retry configuration overrides
 * @returns RetryResult containing the generated text on success
 *
 * @example
 * const retryResult = await generateTextWithRetry({ model, messages })
 * if (!retryResult.success) {
 *   throw retryResult.error
 * }
 * return retryResult.result.text
 */
export async function generateTextWithRetry(
  params: GenerateTextParams,
  options?: StreamRetryOptions,
): Promise<RetryResult<GenerateTextResult>> {
  const retryConfig: Partial<RetryConfig> = {
    maxRetries: options?.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries,
    initialDelayMs: options?.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
  }

  return withRetry(
    () => generateText(params),
    retryConfig,
    (attempt, delay, error, category) => {
      logger.warn(
        {
          attempt,
          delay,
          error: error.message,
          category,
        },
        'Retrying generateText',
      )
    },
  )
}
