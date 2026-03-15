/**
 * Error Classification for Observability
 *
 * Structured error categorization for alerting, debugging, and metrics.
 * Provides consistent error attributes for spans and logs.
 */

/**
 * Error category types for classification
 */
export type ErrorCategory =
  | 'validation' // Bad input, schema errors, malformed data
  | 'network' // Connection failures, timeouts, DNS issues
  | 'auth' // API key issues, permission denied, unauthorized
  | 'rate_limit' // 429 errors, quota exceeded temporarily
  | 'quota' // Usage limits exceeded (permanent until reset)
  | 'timeout' // Request/operation timeouts
  | 'not_found' // Resource not found (404, missing file)
  | 'conflict' // Resource conflict (409, already exists)
  | 'internal' // Unexpected errors, bugs, assertions
  | 'dependency' // External service failures
  | 'cancelled' // Operation was cancelled by user/system
  | 'unknown' // Unclassified errors

/**
 * Classified error with metadata for observability
 */
export interface ClassifiedError {
  /** Error category for routing and alerting */
  category: ErrorCategory
  /** Whether the error is retryable */
  retryable: boolean
  /** Human-readable error message */
  message: string
  /** Original error if available */
  originalError?: Error
  /** HTTP status code if applicable */
  statusCode?: number
  /** Suggested retry delay in milliseconds (for rate limits) */
  retryAfterMs?: number
}

/**
 * Error patterns for classification.
 *
 * ORDER MATTERS — first match wins. Patterns are ordered from most specific
 * (auth, rate_limit, quota) to least specific (validation, internal) so that
 * precise categories are assigned before broad catch-alls can fire.
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp
  category: ErrorCategory
  retryable: boolean
  extractStatusCode?: (message: string) => number | undefined
  extractRetryAfter?: (message: string) => number | undefined
}> = [
  // Auth errors (not retryable)
  {
    pattern:
      /\b401\b|\b403\b|api.?key|unauthorized|forbidden|permission.?denied|invalid.?credentials/i,
    category: 'auth',
    retryable: false,
    extractStatusCode: (msg) => {
      const match = msg.match(/\b(401|403)\b/)
      return match ? parseInt(match[1], 10) : undefined
    },
  },

  // Rate limits (retryable with delay)
  {
    pattern: /\b429\b|rate.?limit|too.?many.?requests|throttl/i,
    category: 'rate_limit',
    retryable: true,
    extractStatusCode: () => 429,
    extractRetryAfter: (msg) => {
      const match = msg.match(/retry.?after[:\s]+(\d+)/i)
      return match ? parseInt(match[1], 10) * 1000 : undefined
    },
  },

  // Quota exceeded (not immediately retryable)
  {
    pattern: /quota.?exceeded|usage.?limit|billing|payment.?required|\b402\b/i,
    category: 'quota',
    retryable: false,
    extractStatusCode: () => 402,
  },

  // Timeout errors (retryable)
  {
    pattern: /timeout|ETIMEDOUT|timed?.?out|deadline.?exceeded/i,
    category: 'timeout',
    retryable: true,
  },

  // Network errors (retryable)
  {
    pattern: /network|ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|socket.?hang/i,
    category: 'network',
    retryable: true,
  },

  // Not found errors (not retryable)
  {
    pattern: /\b404\b|not.?found|does.?not.?exist|no.?such.?file|ENOENT/i,
    category: 'not_found',
    retryable: false,
    extractStatusCode: () => 404,
  },

  // Conflict errors (not typically retryable)
  {
    pattern: /\b409\b|conflict|already.?exists|duplicate/i,
    category: 'conflict',
    retryable: false,
    extractStatusCode: () => 409,
  },

  // Validation errors (not retryable)
  {
    pattern: /\b400\b|invalid|malformed|schema|validation|parse.?error|syntax.?error|bad.?request/i,
    category: 'validation',
    retryable: false,
    extractStatusCode: (msg) => {
      if (/\b400\b|bad.?request/i.test(msg)) return 400
      return undefined
    },
  },

  // Cancelled (not retryable)
  {
    pattern: /cancel|abort|ECANCELED/i,
    category: 'cancelled',
    retryable: false,
  },

  // Dependency failures (retryable)
  {
    pattern: /\b503\b|\b502\b|\b504\b|service.?unavailable|bad.?gateway|gateway.?timeout|upstream/i,
    category: 'dependency',
    retryable: true,
    extractStatusCode: (msg) => {
      const match = msg.match(/\b(502|503|504)\b/)
      return match ? parseInt(match[1], 10) : undefined
    },
  },

  // Internal server errors (may be retryable)
  {
    pattern: /\b500\b|internal.?server|internal.?error/i,
    category: 'internal',
    retryable: true,
    extractStatusCode: () => 500,
  },
]

/**
 * Classify an error into a structured category
 *
 * @example
 * ```typescript
 * try {
 *   await apiCall()
 * } catch (error) {
 *   const classified = classifyError(error)
 *   span.setAttribute('error.category', classified.category)
 *   span.setAttribute('error.retryable', classified.retryable)
 *   metrics.counter('error.count').add(1, { category: classified.category })
 * }
 * ```
 */
export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error)
  const originalError = error instanceof Error ? error : undefined

  // Try to match against known patterns
  for (const {
    pattern,
    category,
    retryable,
    extractStatusCode,
    extractRetryAfter,
  } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return {
        category,
        retryable,
        message,
        originalError,
        statusCode: extractStatusCode?.(message),
        retryAfterMs: extractRetryAfter?.(message),
      }
    }
  }

  // Default to unknown/internal
  return {
    category: 'unknown',
    retryable: false,
    message,
    originalError,
  }
}

/**
 * Get span attributes for an error
 *
 * @example
 * ```typescript
 * const attrs = getErrorSpanAttributes(error)
 * span.setAttributes(attrs)
 * ```
 */
export function getErrorSpanAttributes(error: unknown): Record<string, string | number | boolean> {
  const classified = classifyError(error)
  const attrs: Record<string, string | number | boolean> = {
    'error.category': classified.category,
    'error.retryable': classified.retryable,
    'error.message': classified.message.slice(0, 1024), // Truncate long messages
  }

  if (classified.statusCode !== undefined) {
    attrs['error.status_code'] = classified.statusCode
  }

  if (classified.retryAfterMs !== undefined) {
    attrs['error.retry_after_ms'] = classified.retryAfterMs
  }

  if (classified.originalError?.name) {
    attrs['error.type'] = classified.originalError.name
  }

  return attrs
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  return classifyError(error).retryable
}

/**
 * Get suggested retry delay for an error (in ms)
 * Returns undefined if not applicable
 */
export function getRetryDelay(error: unknown): number | undefined {
  const classified = classifyError(error)
  if (!classified.retryable) return undefined
  return classified.retryAfterMs
}
