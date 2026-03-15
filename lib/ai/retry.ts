/**
 * LLM retry logic with exponential backoff.
 *
 * Provides retry capability for transient LLM failures (rate limits, server errors,
 * network issues) while immediately failing on permanent errors (auth, bad requests).
 */

import {
  classifyError as classifyObsError,
  getErrorSpanAttributes,
  obs,
  SemanticAttributes,
} from '../observability/index.js'
import { isAbortError } from '../pipeline/errors.js'
import { Metrics, Spans } from './signals.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Error classification for retry decisions.
 *
 * RETRYABLE: Transient errors that may succeed on retry
 * - 429: Rate limit (respect Retry-After header)
 * - 5xx: Server errors (500, 502, 503, 504)
 * - Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
 * - Timeout errors (our own withTimeout)
 *
 * PERMANENT: Errors that will never succeed
 * - 400: Bad request (malformed input)
 * - 401/403: Auth errors
 * - 404: Model not found
 * - Content policy violations
 */
export type ErrorCategory = 'retryable' | 'permanent'

export interface RetryConfig {
  /** Max retry attempts (default: 3) */
  maxRetries: number
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs: number
  /** Maximum delay cap in ms (default: 30000) */
  maxDelayMs: number
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier: number
  /** Add random jitter 0-25% to prevent thundering herd (default: true) */
  jitter: boolean
  /** Optional callback for retry events (logging, metrics) */
  onRetry?: (attempt: number, delay: number, error: Error, category: ErrorCategory) => void
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

export interface RetryResult<T> {
  success: boolean
  result?: T
  error?: Error
  attempts: number
  totalDelayMs: number
  finalCategory?: ErrorCategory
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify an error as retryable or permanent.
 *
 * Handles AI SDK error formats and standard HTTP errors.
 */
export function classifyError(err: unknown): ErrorCategory {
  const message = err instanceof Error ? err.message : String(err)
  const lowerMsg = message.toLowerCase()

  // Check for timeout (always retryable)
  if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out')) {
    return 'retryable'
  }

  // Check for network errors (retryable)
  const networkErrors = [
    'econnrefused',
    'etimedout',
    'enotfound',
    'econnreset',
    'socket hang up',
    'network',
    'fetch failed',
  ]
  if (networkErrors.some((ne) => lowerMsg.includes(ne))) {
    return 'retryable'
  }

  // Check for HTTP status codes
  // AI SDK errors often contain status code in message
  if (/429|rate.?limit/i.test(message)) return 'retryable'
  if (/50[0234]|server.?error|internal.?error|service.?unavailable/i.test(message)) {
    return 'retryable'
  }
  if (/502|bad.?gateway/i.test(message)) return 'retryable'
  if (/503|unavailable/i.test(message)) return 'retryable'
  if (/504|gateway.?timeout/i.test(message)) return 'retryable'

  // Permanent errors
  if (/400|bad.?request|invalid/i.test(message)) return 'permanent'
  if (/401|unauthorized|api.?key/i.test(message)) return 'permanent'
  if (/403|forbidden|permission/i.test(message)) return 'permanent'
  if (/404|not.?found|model.*not/i.test(message)) return 'permanent'
  if (/content.?policy|safety|filtered/i.test(message)) return 'permanent'

  // Default to permanent for unknown errors (conservative)
  return 'permanent'
}

/**
 * Extract Retry-After header value from rate limit errors.
 * Returns delay in milliseconds, or undefined if not present.
 */
export function extractRetryAfter(err: unknown): number | undefined {
  const message = err instanceof Error ? err.message : String(err)

  // Common patterns: "Retry-After: 5", "retry after 5s", "wait 5 seconds"
  const match =
    message.match(/retry.?after:?\s*(\d+)/i) || message.match(/wait\s+(\d+)\s*(?:s|sec)/i)

  if (match) {
    const seconds = parseInt(match[1], 10)
    if (!Number.isNaN(seconds) && seconds > 0 && seconds < 300) {
      return seconds * 1000
    }
  }
  return undefined
}

// ============================================================================
// Delay Calculation
// ============================================================================

/**
 * Calculate delay for a given attempt with exponential backoff.
 *
 * Formula: min(maxDelay, initialDelay * multiplier^attempt) * (1 + jitter)
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterMs?: number,
): number {
  // Respect Retry-After header if present
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, config.maxDelayMs)
  }

  // Exponential backoff: 1s -> 2s -> 4s -> 8s (with multiplier 2)
  const exponentialDelay = config.initialDelayMs * config.backoffMultiplier ** attempt
  let delay = Math.min(exponentialDelay, config.maxDelayMs)

  // Add jitter to prevent thundering herd
  if (config.jitter) {
    const jitterFactor = 1 + Math.random() * 0.25 // 0-25% additional
    delay = Math.floor(delay * jitterFactor)
  }

  return delay
}

/**
 * Sleep helper for retry delays.
 * Optionally accepts an AbortSignal — when aborted, the timer is cleared
 * and the promise rejects with the signal's reason.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('Aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ============================================================================
// Timeout Wrapper
// ============================================================================

/**
 * Wrap a promise with a timeout.
 *
 * Consolidates duplicate implementations from:
 * - NpcAgent.ts:49-54
 * - SubAgent.ts:20-25
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    // Prevent timer from keeping Node process alive
    timer.unref?.()
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// ============================================================================
// Abort Retry Signal
// ============================================================================

/**
 * Throw this inside a withRetry callback to immediately abort retrying.
 *
 * Used by formatStream to prevent duplicate chunk emission: once chunks
 * have been sent to the caller, retrying would produce duplicate content.
 */
export class AbortRetryError extends Error {
  constructor(cause?: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause ?? 'Retry aborted')
    super(msg, { cause })
    this.name = 'AbortRetryError'
  }
}

// ============================================================================
// Retry Wrapper
// ============================================================================

/**
 * Execute an async function with retry logic.
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration (optional, uses defaults)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<RetryResult<T>> {
  const { tracer, metrics, logger } = obs('ai.retry')

  return tracer.startSpan(Spans.RETRY, async (span) => {
    const cfg = { ...DEFAULT_RETRY_CONFIG, ...config }
    span.setAttribute('maxRetries', cfg.maxRetries)

    let lastError: Error | undefined
    let totalDelayMs = 0
    let lastCategory: ErrorCategory = 'permanent'

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      cfg.signal?.throwIfAborted()

      try {
        const result = await fn()

        span.setAttribute(SemanticAttributes.ATTEMPTS, attempt + 1)
        span.setAttribute('totalDelayMs', totalDelayMs)
        span.setAttribute(SemanticAttributes.SUCCESS, true)

        if (attempt > 0) {
          metrics.counter(Metrics.RETRY_SUCCESS_COUNT).add(1, { attempts: String(attempt + 1) })
          logger.debug({ attempts: attempt + 1, totalDelayMs }, 'Retry succeeded')
        }

        return {
          success: true,
          result,
          attempts: attempt + 1,
          totalDelayMs,
        }
      } catch (err) {
        // AbortRetryError: caller explicitly requested no further retries
        if (err instanceof AbortRetryError) {
          const inner = err.cause instanceof Error ? err.cause : err
          span.setAttribute(SemanticAttributes.ATTEMPTS, attempt + 1)
          span.setAttribute(SemanticAttributes.SUCCESS, false)
          span.setAttribute('finalCategory', 'permanent')
          span.setAttribute('abortedRetry', true)
          return {
            success: false,
            error: inner,
            attempts: attempt + 1,
            totalDelayMs,
            finalCategory: 'permanent' as ErrorCategory,
          }
        }

        // Abort errors (DOMException or custom AbortError) should propagate,
        // not be swallowed into a RetryResult.
        if (isAbortError(err)) {
          throw err
        }

        lastError = err instanceof Error ? err : new Error(String(err))
        lastCategory = classifyError(err)

        // Add detailed error attributes from observability classification
        const obsClassified = classifyObsError(err)
        const errorAttrs = getErrorSpanAttributes(err)
        span.setAttributes(errorAttrs)
        span.setAttribute('lastErrorCategory', lastCategory)

        // Don't retry permanent errors
        if (lastCategory === 'permanent') {
          span.setAttribute(SemanticAttributes.ATTEMPTS, attempt + 1)
          span.setAttribute(SemanticAttributes.SUCCESS, false)
          span.setAttribute('finalCategory', lastCategory)
          metrics.counter(Metrics.RETRY_FAILURE_COUNT).add(1, { category: lastCategory })
          metrics.counter(Metrics.ERROR_COUNT).add(1, { category: obsClassified.category })

          return {
            success: false,
            error: lastError,
            attempts: attempt + 1,
            totalDelayMs,
            finalCategory: lastCategory,
          }
        }

        // Don't delay after last attempt
        if (attempt < cfg.maxRetries) {
          const retryAfterMs = extractRetryAfter(err)
          const delay = calculateDelay(attempt, cfg, retryAfterMs)

          metrics.counter(Metrics.RETRY_ATTEMPT_COUNT).add(1, { category: lastCategory })
          logger.debug(
            { attempt: attempt + 1, delay, category: lastCategory, error: lastError.message },
            'Retrying after transient error',
          )

          cfg.onRetry?.(attempt + 1, delay, lastError, lastCategory)

          await sleep(delay, cfg.signal)
          totalDelayMs += delay
        }
      }
    }

    // Exhausted retries
    const finalObsClassified = classifyObsError(lastError)
    span.setAttribute(SemanticAttributes.ATTEMPTS, cfg.maxRetries + 1)
    span.setAttribute('totalDelayMs', totalDelayMs)
    span.setAttribute(SemanticAttributes.SUCCESS, false)
    span.setAttribute('finalCategory', lastCategory)
    metrics.counter(Metrics.RETRY_EXHAUSTED_COUNT).add(1, { category: lastCategory })
    metrics.counter(Metrics.ERROR_COUNT).add(1, { category: finalObsClassified.category })
    metrics.histogram(Metrics.RETRY_TOTAL_DELAY_MS).record(totalDelayMs)
    logger.warn(
      { attempts: cfg.maxRetries + 1, totalDelayMs, category: lastCategory },
      'Retry attempts exhausted',
    )

    return {
      success: false,
      error: lastError,
      attempts: cfg.maxRetries + 1,
      totalDelayMs,
      finalCategory: lastCategory,
    }
  })
}
