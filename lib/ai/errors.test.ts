import { describe, expect, it } from 'vitest'
import {
  ApiKeyError,
  ContextLengthError,
  LlmError,
  ModelNotFoundError,
  NetworkError,
  ProviderUnavailableError,
  parseApiError,
  RateLimitError,
  TimeoutError,
} from './errors.js'

describe('LlmError', () => {
  it('creates base error with code and provider', () => {
    const error = new LlmError('test message', 'TEST_CODE', 'openai')
    expect(error.message).toBe('test message')
    expect(error.code).toBe('TEST_CODE')
    expect(error.provider).toBe('openai')
    expect(error.name).toBe('LlmError')
  })

  it('preserves cause', () => {
    const cause = new Error('original error')
    const error = new LlmError('wrapped', 'CODE', 'openai', cause)
    expect(error.cause).toBe(cause)
  })
})

describe('ApiKeyError', () => {
  it('creates helpful message for OpenAI', () => {
    const error = new ApiKeyError('OpenAI')
    expect(error.message).toContain('OpenAI API key not found')
    expect(error.message).toContain('OPENAI_API_KEY')
    expect(error.message).toContain('platform.openai.com')
    expect(error.code).toBe('API_KEY_MISSING')
    expect(error.provider).toBe('OpenAI')
    expect(error.name).toBe('ApiKeyError')
  })

  it('creates helpful message for Anthropic', () => {
    const error = new ApiKeyError('Anthropic')
    expect(error.message).toContain('Anthropic API key not found')
    expect(error.message).toContain('ANTHROPIC_API_KEY')
    expect(error.message).toContain('console.anthropic.com')
  })

  it('creates helpful message for Ollama', () => {
    const error = new ApiKeyError('ollama')
    expect(error.message).toContain('OLLAMA_HOST')
  })
})

describe('RateLimitError', () => {
  it('creates message without retryAfter', () => {
    const error = new RateLimitError('OpenAI')
    expect(error.message).toContain('rate limit exceeded')
    expect(error.message).toContain('automatically retried')
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.name).toBe('RateLimitError')
  })

  it('includes retryAfter in message', () => {
    const error = new RateLimitError('OpenAI', 30)
    expect(error.message).toContain('Retry after 30 seconds')
    expect(error.retryAfter).toBe(30)
  })
})

describe('ModelNotFoundError', () => {
  it('creates message with model name', () => {
    const error = new ModelNotFoundError('OpenAI', 'gpt-99')
    expect(error.message).toContain("Model 'gpt-99' not found")
    expect(error.message).toContain('spelled correctly')
    expect(error.code).toBe('MODEL_NOT_FOUND')
    expect(error.name).toBe('ModelNotFoundError')
  })

  it('includes available models when provided', () => {
    const error = new ModelNotFoundError('OpenAI', 'gpt-99', ['gpt-5', 'gpt-5-mini'])
    expect(error.message).toContain('Available models: gpt-5, gpt-5-mini')
  })
})

describe('ContextLengthError', () => {
  it('creates message with token counts', () => {
    const error = new ContextLengthError('OpenAI', 50000, 32000)
    expect(error.message).toContain('50000 tokens')
    expect(error.message).toContain('max 32000')
    expect(error.message).toContain('larger context')
    expect(error.code).toBe('CONTEXT_LENGTH_EXCEEDED')
    expect(error.name).toBe('ContextLengthError')
  })
})

describe('ProviderUnavailableError', () => {
  it('creates message with reason', () => {
    const error = new ProviderUnavailableError('Ollama', 'Not running at localhost')
    expect(error.message).toContain('Ollama provider is not available')
    expect(error.message).toContain('Not running at localhost')
    expect(error.message).toContain('ollama serve')
    expect(error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(error.name).toBe('ProviderUnavailableError')
  })

  it('creates message without reason', () => {
    const error = new ProviderUnavailableError('OpenAI')
    expect(error.message).toContain('OpenAI provider is not available.')
    // Message should say "is not available." without specific reason appended
    expect(error.message).not.toContain('is not available:')
    expect(error.message).toContain('OPENAI_API_KEY')
  })
})

describe('NetworkError', () => {
  it('creates message with provider', () => {
    const error = new NetworkError('OpenAI')
    expect(error.message).toContain('Failed to connect to OpenAI')
    expect(error.message).toContain('network connection')
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.name).toBe('NetworkError')
  })
})

describe('TimeoutError', () => {
  it('creates message with timeout duration', () => {
    const error = new TimeoutError('OpenAI', 60000)
    expect(error.message).toContain('timed out after 60 seconds')
    expect(error.message).toContain('Increase timeout')
    expect(error.code).toBe('TIMEOUT')
    expect(error.name).toBe('TimeoutError')
  })
})

describe('parseApiError', () => {
  it('returns same error if already LlmError', () => {
    const original = new ApiKeyError('OpenAI')
    const parsed = parseApiError(original, 'OpenAI')
    expect(parsed).toBe(original)
  })

  it('parses API key errors', () => {
    const parsed = parseApiError(new Error('Unauthorized: Invalid API key'), 'OpenAI')
    expect(parsed).toBeInstanceOf(ApiKeyError)
  })

  it('parses 401 errors as API key errors', () => {
    const parsed = parseApiError(new Error('401 authentication failed'), 'OpenAI')
    expect(parsed).toBeInstanceOf(ApiKeyError)
  })

  it('parses rate limit errors', () => {
    const parsed = parseApiError(new Error('Rate limit exceeded'), 'OpenAI')
    expect(parsed).toBeInstanceOf(RateLimitError)
  })

  it('parses 429 errors as rate limit', () => {
    const parsed = parseApiError(new Error('Error 429'), 'OpenAI')
    expect(parsed).toBeInstanceOf(RateLimitError)
  })

  it('extracts retryAfter from rate limit message', () => {
    const parsed = parseApiError(new Error('Rate limit. Retry after: 30'), 'OpenAI')
    expect(parsed).toBeInstanceOf(RateLimitError)
    expect((parsed as RateLimitError).retryAfter).toBe(30)
  })

  it('parses model not found errors', () => {
    const parsed = parseApiError(new Error('model does not exist'), 'OpenAI')
    expect(parsed).toBeInstanceOf(ModelNotFoundError)
  })

  it('parses context length errors', () => {
    const parsed = parseApiError(new Error('context length exceeded'), 'OpenAI')
    expect(parsed).toBeInstanceOf(ContextLengthError)
  })

  it('parses token limit errors', () => {
    const parsed = parseApiError(new Error('too long: 50000 tokens, max 32000'), 'OpenAI')
    expect(parsed).toBeInstanceOf(ContextLengthError)
  })

  it('parses timeout errors', () => {
    const parsed = parseApiError(new Error('ETIMEDOUT'), 'OpenAI')
    expect(parsed).toBeInstanceOf(TimeoutError)
  })

  it('parses network errors', () => {
    const parsed = parseApiError(new Error('ECONNREFUSED'), 'OpenAI')
    expect(parsed).toBeInstanceOf(NetworkError)
  })

  it('creates generic LlmError for unknown errors', () => {
    const parsed = parseApiError(new Error('Something went wrong'), 'OpenAI')
    expect(parsed).toBeInstanceOf(LlmError)
    expect(parsed.code).toBe('API_ERROR')
    expect(parsed.message).toContain('Something went wrong')
  })

  it('handles string errors', () => {
    const parsed = parseApiError('rate limit exceeded', 'OpenAI')
    expect(parsed).toBeInstanceOf(RateLimitError)
  })
})
