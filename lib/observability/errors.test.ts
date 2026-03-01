/**
 * Tests for observability error classification module.
 */

import { classifyError, getErrorSpanAttributes, getRetryDelay, isRetryableError } from './errors.js'

describe('classifyError', () => {
  // [message, category, retryable, statusCode?]
  it.each([
    ['401 Unauthorized', 'auth', false, 401],
    ['403 Forbidden', 'auth', false, 403],
    ['Invalid API key provided', 'auth', false],
    ['Unauthorized access', 'auth', false],
    ['Permission denied', 'auth', false],
    ['429 Too Many Requests', 'rate_limit', true, 429],
    ['Rate limit exceeded', 'rate_limit', true],
    ['Request throttled', 'rate_limit', true],
    ['Quota exceeded', 'quota', false],
    ['402 Payment Required', 'quota', false, 402],
    ['Billing issue detected', 'quota', false],
    ['Request timeout', 'timeout', true],
    ['ETIMEDOUT', 'timeout', true],
    ['Deadline exceeded', 'timeout', true],
    ['ECONNREFUSED', 'network', true],
    ['ECONNRESET', 'network', true],
    ['ENOTFOUND', 'network', true],
    ['socket hang up', 'network', true],
    ['404 Not Found', 'not_found', false, 404],
    ['ENOENT: no such file', 'not_found', false],
    ['Resource does not exist', 'not_found', false],
    ['409 Conflict', 'conflict', false, 409],
    ['Resource already exists', 'conflict', false],
    ['Duplicate entry', 'conflict', false],
    ['400 Bad Request', 'validation', false, 400],
    ['Invalid input provided', 'validation', false],
    ['Schema validation failed', 'validation', false],
    ['Parse error in JSON', 'validation', false],
    ['Operation cancelled', 'cancelled', false],
    ['Request aborted', 'cancelled', false],
    ['ECANCELED', 'cancelled', false],
    ['503 Service Unavailable', 'dependency', true, 503],
    ['502 Bad Gateway', 'dependency', true, 502],
    ['504 bad gateway error', 'dependency', true, 504],
    ['500 Internal Server Error', 'internal', true, 500],
    ['Something unexpected happened', 'unknown', false],
  ] as [
    string,
    string,
    boolean,
    number?,
  ][])('"%s" → %s (retryable=%s)', (message, category, retryable, statusCode) => {
    const result = classifyError(new Error(message))
    expect(result.category).toBe(category)
    expect(result.retryable).toBe(retryable)
    if (statusCode !== undefined) expect(result.statusCode).toBe(statusCode)
  })

  it('extracts retry-after from message', () => {
    const result = classifyError(new Error('Rate limited. Retry-After: 30'))
    expect(result.category).toBe('rate_limit')
    expect(result.retryAfterMs).toBe(30000)
  })

  it('classifies 504 Gateway Timeout as timeout (message contains Timeout)', () => {
    // "504 Gateway Timeout" → 'timeout' because "Timeout" pattern takes precedence
    const result = classifyError(new Error('504 Gateway Timeout'))
    expect(result.category).toBe('timeout')
    expect(result.retryable).toBe(true)
  })

  it('handles string errors', () => {
    const result = classifyError('just a string error')
    expect(result.category).toBe('unknown')
    expect(result.message).toBe('just a string error')
  })

  it('handles non-error objects', () => {
    const result = classifyError({ code: 'WEIRD' })
    expect(result.category).toBe('unknown')
  })

  it('preserves Error instance as originalError', () => {
    const original = new Error('test error')
    const result = classifyError(original)
    expect(result.originalError).toBe(original)
  })

  it('does not set originalError for string errors', () => {
    const result = classifyError('string error')
    expect(result.originalError).toBeUndefined()
  })
})

describe('getErrorSpanAttributes', () => {
  it('returns category and retryable attributes', () => {
    const attrs = getErrorSpanAttributes(new Error('429 Rate limit'))
    expect(attrs['error.category']).toBe('rate_limit')
    expect(attrs['error.retryable']).toBe(true)
  })

  it('truncates long messages to 1024 chars', () => {
    const longMessage = 'x'.repeat(2000)
    const attrs = getErrorSpanAttributes(new Error(longMessage))
    expect((attrs['error.message'] as string).length).toBe(1024)
  })

  it('includes status code when available', () => {
    const attrs = getErrorSpanAttributes(new Error('404 Not Found'))
    expect(attrs['error.status_code']).toBe(404)
  })

  it('includes error type from Error name', () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message)
        this.name = 'CustomError'
      }
    }
    const attrs = getErrorSpanAttributes(new CustomError('test'))
    expect(attrs['error.type']).toBe('CustomError')
  })

  it('includes retry_after_ms when available', () => {
    const attrs = getErrorSpanAttributes(new Error('Rate limited. Retry-After: 60'))
    expect(attrs['error.retry_after_ms']).toBe(60000)
  })
})

describe('isRetryableError', () => {
  it('returns true for retryable errors', () => {
    expect(isRetryableError(new Error('429 Rate limit'))).toBe(true)
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true)
    expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true)
    expect(isRetryableError(new Error('timeout'))).toBe(true)
  })

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false)
    expect(isRetryableError(new Error('400 Bad Request'))).toBe(false)
    expect(isRetryableError(new Error('404 Not Found'))).toBe(false)
    expect(isRetryableError(new Error('unknown error'))).toBe(false)
  })
})

describe('getRetryDelay', () => {
  it('returns retryAfterMs for rate limit errors', () => {
    const delay = getRetryDelay(new Error('Rate limited. Retry-After: 30'))
    expect(delay).toBe(30000)
  })

  it('returns undefined for non-retryable errors', () => {
    const delay = getRetryDelay(new Error('401 Unauthorized'))
    expect(delay).toBeUndefined()
  })

  it('returns undefined for retryable errors without retry-after', () => {
    const delay = getRetryDelay(new Error('ECONNREFUSED'))
    expect(delay).toBeUndefined()
  })
})
