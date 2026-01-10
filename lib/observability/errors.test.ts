/**
 * Tests for observability error classification module.
 */

import { describe, expect, it } from 'vitest'
import { classifyError, getErrorSpanAttributes, getRetryDelay, isRetryableError } from './errors.js'

describe('classifyError', () => {
  describe('auth errors', () => {
    it('classifies 401 errors as auth', () => {
      const result = classifyError(new Error('401 Unauthorized'))
      expect(result.category).toBe('auth')
      expect(result.retryable).toBe(false)
      expect(result.statusCode).toBe(401)
    })

    it('classifies 403 errors as auth', () => {
      const result = classifyError(new Error('403 Forbidden'))
      expect(result.category).toBe('auth')
      expect(result.retryable).toBe(false)
      expect(result.statusCode).toBe(403)
    })

    it('classifies API key errors as auth', () => {
      const result = classifyError(new Error('Invalid API key provided'))
      expect(result.category).toBe('auth')
      expect(result.retryable).toBe(false)
    })

    it('classifies unauthorized errors as auth', () => {
      const result = classifyError(new Error('Unauthorized access'))
      expect(result.category).toBe('auth')
      expect(result.retryable).toBe(false)
    })

    it('classifies permission denied errors as auth', () => {
      const result = classifyError(new Error('Permission denied'))
      expect(result.category).toBe('auth')
      expect(result.retryable).toBe(false)
    })
  })

  describe('rate limit errors', () => {
    it('classifies 429 errors as rate_limit', () => {
      const result = classifyError(new Error('429 Too Many Requests'))
      expect(result.category).toBe('rate_limit')
      expect(result.retryable).toBe(true)
      expect(result.statusCode).toBe(429)
    })

    it('classifies rate limit messages', () => {
      const result = classifyError(new Error('Rate limit exceeded'))
      expect(result.category).toBe('rate_limit')
      expect(result.retryable).toBe(true)
    })

    it('extracts retry-after from message', () => {
      const result = classifyError(new Error('Rate limited. Retry-After: 30'))
      expect(result.category).toBe('rate_limit')
      expect(result.retryAfterMs).toBe(30000)
    })

    it('classifies throttling errors as rate_limit', () => {
      const result = classifyError(new Error('Request throttled'))
      expect(result.category).toBe('rate_limit')
      expect(result.retryable).toBe(true)
    })
  })

  describe('quota errors', () => {
    it('classifies quota exceeded errors', () => {
      const result = classifyError(new Error('Quota exceeded'))
      expect(result.category).toBe('quota')
      expect(result.retryable).toBe(false)
    })

    it('classifies 402 payment required errors', () => {
      const result = classifyError(new Error('402 Payment Required'))
      expect(result.category).toBe('quota')
      expect(result.statusCode).toBe(402)
    })

    it('classifies billing errors as quota', () => {
      const result = classifyError(new Error('Billing issue detected'))
      expect(result.category).toBe('quota')
      expect(result.retryable).toBe(false)
    })
  })

  describe('timeout errors', () => {
    it('classifies timeout errors', () => {
      const result = classifyError(new Error('Request timeout'))
      expect(result.category).toBe('timeout')
      expect(result.retryable).toBe(true)
    })

    it('classifies ETIMEDOUT errors', () => {
      const result = classifyError(new Error('ETIMEDOUT'))
      expect(result.category).toBe('timeout')
      expect(result.retryable).toBe(true)
    })

    it('classifies deadline exceeded errors', () => {
      const result = classifyError(new Error('Deadline exceeded'))
      expect(result.category).toBe('timeout')
      expect(result.retryable).toBe(true)
    })
  })

  describe('network errors', () => {
    it('classifies ECONNREFUSED errors', () => {
      const result = classifyError(new Error('ECONNREFUSED'))
      expect(result.category).toBe('network')
      expect(result.retryable).toBe(true)
    })

    it('classifies ECONNRESET errors', () => {
      const result = classifyError(new Error('ECONNRESET'))
      expect(result.category).toBe('network')
      expect(result.retryable).toBe(true)
    })

    it('classifies ENOTFOUND errors', () => {
      const result = classifyError(new Error('ENOTFOUND'))
      expect(result.category).toBe('network')
      expect(result.retryable).toBe(true)
    })

    it('classifies socket hang up errors', () => {
      const result = classifyError(new Error('socket hang up'))
      expect(result.category).toBe('network')
      expect(result.retryable).toBe(true)
    })
  })

  describe('not_found errors', () => {
    it('classifies 404 errors', () => {
      const result = classifyError(new Error('404 Not Found'))
      expect(result.category).toBe('not_found')
      expect(result.retryable).toBe(false)
      expect(result.statusCode).toBe(404)
    })

    it('classifies ENOENT errors', () => {
      const result = classifyError(new Error('ENOENT: no such file'))
      expect(result.category).toBe('not_found')
      expect(result.retryable).toBe(false)
    })

    it('classifies does not exist errors', () => {
      const result = classifyError(new Error('Resource does not exist'))
      expect(result.category).toBe('not_found')
      expect(result.retryable).toBe(false)
    })
  })

  describe('conflict errors', () => {
    it('classifies 409 errors', () => {
      const result = classifyError(new Error('409 Conflict'))
      expect(result.category).toBe('conflict')
      expect(result.retryable).toBe(false)
      expect(result.statusCode).toBe(409)
    })

    it('classifies already exists errors', () => {
      const result = classifyError(new Error('Resource already exists'))
      expect(result.category).toBe('conflict')
      expect(result.retryable).toBe(false)
    })

    it('classifies duplicate errors', () => {
      const result = classifyError(new Error('Duplicate entry'))
      expect(result.category).toBe('conflict')
      expect(result.retryable).toBe(false)
    })
  })

  describe('validation errors', () => {
    it('classifies 400 errors', () => {
      const result = classifyError(new Error('400 Bad Request'))
      expect(result.category).toBe('validation')
      expect(result.retryable).toBe(false)
      expect(result.statusCode).toBe(400)
    })

    it('classifies invalid input errors', () => {
      const result = classifyError(new Error('Invalid input provided'))
      expect(result.category).toBe('validation')
      expect(result.retryable).toBe(false)
    })

    it('classifies schema errors', () => {
      const result = classifyError(new Error('Schema validation failed'))
      expect(result.category).toBe('validation')
      expect(result.retryable).toBe(false)
    })

    it('classifies parse errors', () => {
      const result = classifyError(new Error('Parse error in JSON'))
      expect(result.category).toBe('validation')
      expect(result.retryable).toBe(false)
    })
  })

  describe('cancelled errors', () => {
    it('classifies cancelled errors', () => {
      const result = classifyError(new Error('Operation cancelled'))
      expect(result.category).toBe('cancelled')
      expect(result.retryable).toBe(false)
    })

    it('classifies abort errors', () => {
      const result = classifyError(new Error('Request aborted'))
      expect(result.category).toBe('cancelled')
      expect(result.retryable).toBe(false)
    })

    it('classifies ECANCELED errors', () => {
      const result = classifyError(new Error('ECANCELED'))
      expect(result.category).toBe('cancelled')
      expect(result.retryable).toBe(false)
    })
  })

  describe('dependency errors', () => {
    it('classifies 503 errors', () => {
      const result = classifyError(new Error('503 Service Unavailable'))
      expect(result.category).toBe('dependency')
      expect(result.retryable).toBe(true)
      expect(result.statusCode).toBe(503)
    })

    it('classifies 502 errors', () => {
      const result = classifyError(new Error('502 Bad Gateway'))
      expect(result.category).toBe('dependency')
      expect(result.retryable).toBe(true)
      expect(result.statusCode).toBe(502)
    })

    it('classifies 504 errors as timeout (due to message containing Timeout)', () => {
      // Note: "504 Gateway Timeout" is classified as 'timeout' because
      // the message contains "Timeout" which takes precedence over status code
      const result = classifyError(new Error('504 Gateway Timeout'))
      expect(result.category).toBe('timeout')
      expect(result.retryable).toBe(true)
      // statusCode is undefined because timeout pattern matches first and doesn't extract it
    })

    it('classifies 504 errors as dependency when message lacks Timeout keyword', () => {
      const result = classifyError(new Error('504 bad gateway error'))
      expect(result.category).toBe('dependency')
      expect(result.retryable).toBe(true)
      expect(result.statusCode).toBe(504)
    })
  })

  describe('internal errors', () => {
    it('classifies 500 errors as internal (retryable)', () => {
      const result = classifyError(new Error('500 Internal Server Error'))
      expect(result.category).toBe('internal')
      expect(result.retryable).toBe(true)
      expect(result.statusCode).toBe(500)
    })
  })

  describe('unknown errors', () => {
    it('classifies unrecognized errors as unknown', () => {
      const result = classifyError(new Error('Something unexpected happened'))
      expect(result.category).toBe('unknown')
      expect(result.retryable).toBe(false)
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
  })

  describe('originalError preservation', () => {
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
