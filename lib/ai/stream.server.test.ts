import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the AI SDK
vi.mock('ai', () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
}))

// Mock observability
vi.mock('../observability/index.js', () => ({
  obs: () => ({
    logger: {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    tracer: {
      startSpan: vi.fn((_name: string, fn: (span: unknown) => unknown) =>
        fn({
          setAttribute: vi.fn(),
          setAttributes: vi.fn(),
          setStatus: vi.fn(),
          recordException: vi.fn(),
          end: vi.fn(),
        }),
      ),
    },
    metrics: {
      counter: vi.fn(() => ({ add: vi.fn() })),
      histogram: vi.fn(() => ({ record: vi.fn() })),
    },
  }),
  classifyError: () => ({ category: 'unknown', retryable: false }),
  getErrorSpanAttributes: () => ({}),
  SemanticMetrics: {
    AI_RETRY_SUCCESSES: 'ai.retry.successes',
    AI_RETRY_FAILURES: 'ai.retry.failures',
    AI_RETRY_ATTEMPTS: 'ai.retry.attempts',
    AI_RETRY_EXHAUSTED: 'ai.retry.exhausted',
    AI_RETRY_TOTAL_DELAY_MS: 'ai.retry.total_delay_ms',
    ERROR_COUNT: 'error.count',
  },
}))

import { generateText, streamText } from 'ai'
import { generateTextWithRetry, streamTextWithRetry } from './stream.server.js'

const mockStreamText = vi.mocked(streamText)
const mockGenerateText = vi.mocked(generateText)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('streamTextWithRetry', () => {
  it('returns result on first success', async () => {
    const mockResult = {
      textStream: (async function* () {
        yield 'hello'
      })(),
      toTextStreamResponse: () => new Response('hello'),
    }
    mockStreamText.mockReturnValue(mockResult as unknown as ReturnType<typeof streamText>)

    const result = await streamTextWithRetry({ model: {} as never, messages: [] })

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.totalDelayMs).toBe(0)
    expect(mockStreamText).toHaveBeenCalledTimes(1)
  })

  it('retries on 503 and succeeds', async () => {
    const mockResult = {
      textStream: (async function* () {
        yield 'hello'
      })(),
    }

    mockStreamText
      .mockImplementationOnce(() => {
        throw new Error('503 Service Unavailable')
      })
      .mockReturnValue(mockResult as unknown as ReturnType<typeof streamText>)

    const result = await streamTextWithRetry(
      { model: {} as never, messages: [] },
      { maxRetries: 2, initialDelayMs: 10 },
    )

    expect(result.success).toBe(true)
    expect(result.attempts).toBe(2)
    expect(mockStreamText).toHaveBeenCalledTimes(2)
  })

  it('does not retry on 401 (permanent error)', async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error('401 Unauthorized - Invalid API key')
    })

    const result = await streamTextWithRetry(
      { model: {} as never, messages: [] },
      { maxRetries: 3 },
    )

    expect(result.success).toBe(false)
    expect(result.attempts).toBe(1)
    expect(result.finalCategory).toBe('permanent')
    expect(result.error?.message).toBe('401 Unauthorized - Invalid API key')
    expect(mockStreamText).toHaveBeenCalledTimes(1)
  })

  it('exhausts retries and returns error', async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error('503 Service Unavailable')
    })

    const result = await streamTextWithRetry(
      { model: {} as never, messages: [] },
      { maxRetries: 2, initialDelayMs: 10 },
    )

    expect(result.success).toBe(false)
    expect(result.attempts).toBe(3) // 1 initial + 2 retries
    expect(result.finalCategory).toBe('retryable')
    expect(mockStreamText).toHaveBeenCalledTimes(3)
  })
})

describe('generateTextWithRetry', () => {
  it('returns result on first success', async () => {
    const mockResult = { text: 'Generated text', usage: { totalTokens: 10 } }
    mockGenerateText.mockResolvedValue(mockResult as Awaited<ReturnType<typeof generateText>>)

    const result = await generateTextWithRetry({ model: {} as never, messages: [] })

    expect(result.success).toBe(true)
    expect(result.result?.text).toBe('Generated text')
    expect(result.attempts).toBe(1)
    expect(mockGenerateText).toHaveBeenCalledTimes(1)
  })

  it('retries on rate limit and succeeds', async () => {
    const mockResult = { text: 'Success', usage: { totalTokens: 5 } }

    mockGenerateText
      .mockRejectedValueOnce(new Error('429 Rate limit exceeded'))
      .mockResolvedValue(mockResult as Awaited<ReturnType<typeof generateText>>)

    const result = await generateTextWithRetry(
      { model: {} as never, messages: [] },
      { maxRetries: 2, initialDelayMs: 10 },
    )

    expect(result.success).toBe(true)
    expect(result.result?.text).toBe('Success')
    expect(result.attempts).toBe(2)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
  })

  it('does not retry on content policy error', async () => {
    mockGenerateText.mockRejectedValue(new Error('Content policy violation'))

    const result = await generateTextWithRetry(
      { model: {} as never, messages: [] },
      { maxRetries: 3 },
    )

    expect(result.success).toBe(false)
    expect(result.attempts).toBe(1)
    expect(result.finalCategory).toBe('permanent')
    expect(mockGenerateText).toHaveBeenCalledTimes(1)
  })

  it('exhausts retries on network error', async () => {
    mockGenerateText.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await generateTextWithRetry(
      { model: {} as never, messages: [] },
      { maxRetries: 2, initialDelayMs: 10 },
    )

    expect(result.success).toBe(false)
    expect(result.attempts).toBe(3)
    expect(result.finalCategory).toBe('retryable')
    expect(mockGenerateText).toHaveBeenCalledTimes(3)
  })
})
