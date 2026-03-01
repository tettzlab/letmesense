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
  it('preserves cause', () => {
    const cause = new Error('original error')
    const error = new LlmError('wrapped', 'CODE', 'openai', cause)
    expect(error.cause).toBe(cause)
  })
})

describe('error subclasses', () => {
  it.each([
    { Ctor: ApiKeyError, code: 'API_KEY_MISSING', args: ['OpenAI'] },
    { Ctor: RateLimitError, code: 'RATE_LIMITED', args: ['OpenAI'] },
    { Ctor: ModelNotFoundError, code: 'MODEL_NOT_FOUND', args: ['OpenAI', 'gpt-99'] },
    { Ctor: ContextLengthError, code: 'CONTEXT_LENGTH_EXCEEDED', args: ['OpenAI', 50000, 32000] },
    {
      Ctor: ProviderUnavailableError,
      code: 'PROVIDER_UNAVAILABLE',
      args: ['Ollama', 'Not running'],
    },
    { Ctor: NetworkError, code: 'NETWORK_ERROR', args: ['OpenAI'] },
    { Ctor: TimeoutError, code: 'TIMEOUT', args: ['OpenAI', 60000] },
  ] as const)('$Ctor.name has code=$code', ({ Ctor, code, args }) => {
    // @ts-expect-error dynamic constructor args
    const error = new Ctor(...args)
    expect(error.code).toBe(code)
    expect(error).toBeInstanceOf(LlmError)
  })

  it('RateLimitError stores retryAfter', () => {
    const error = new RateLimitError('OpenAI', 30)
    expect(error.retryAfter).toBe(30)
  })

  it('ModelNotFoundError includes available models', () => {
    const error = new ModelNotFoundError('OpenAI', 'gpt-99', ['gpt-5', 'gpt-5-mini'])
    expect(error.message).toContain('Available models: gpt-5, gpt-5-mini')
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
