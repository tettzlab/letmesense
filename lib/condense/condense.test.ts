import { mockObs, mockSignals } from '../testing/index.js'

// ── Mock dependencies ──────────────────────────────────────────────────────

vi.mock('../ai/resolve.js', () => ({
  resolveModel: vi.fn(() => ({
    provider: 'openai',
    modelId: 'gpt-5-mini',
    modelConfig: null,
    pricing: { input: 0.15, output: 0.6, image: null },
    encoding: 'o200k_base',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    effort: null,
    temperature: { min: 0, max: 2, default: 1 },
  })),
}))

vi.mock('../ai/createModel.js', () => ({
  createModel: vi.fn(() => ({ modelId: 'gpt-5-mini' })),
}))

vi.mock('../ai/tokenCounter.js', () => ({
  countTokensWithEncoding: vi.fn((text: string) => {
    if (!text || !text.trim()) return 0
    return text.split(/\s+/).length
  }),
}))

vi.mock('../ai/cost.js', () => ({
  calculateCost: vi.fn(
    (input: number, output: number, _image: number, pricing: { input: number; output: number }) =>
      (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output,
  ),
}))

vi.mock('../ai/provider.js', () => ({
  detectProvider: vi.fn(() => ({ provider: 'openai', reason: 'test' })),
}))

vi.mock('../observability/index.js', () => mockObs())

vi.mock('./signals.js', () =>
  mockSignals({
    Spans: {
      RUN: 'condense.run',
      MAP: 'condense.map',
      REDUCE: 'condense.reduce',
      LLM: 'condense.llm',
    },
    Metrics: {
      RUN_COUNT: 'condense.run.count',
      RUN_DURATION_MS: 'condense.run.duration_ms',
      MAP_CHUNK_COUNT: 'condense.map.chunk.count',
      REDUCE_DEPTH: 'condense.reduce.depth',
      TOKEN_INPUT_COUNT: 'condense.token.input.count',
      TOKEN_OUTPUT_COUNT: 'condense.token.output.count',
      COST_USD: 'condense.cost.usd',
      ERROR_COUNT: 'condense.error.count',
    },
  }),
)

// Default: generateTextWithRetry returns success with halved text
const mockGenerateText: any = vi.fn(async (params: any) => {
  const userMsg = params.messages?.find((m: any) => m.role === 'user')
  const words = (userMsg?.content ?? '').split(/\s+/)
  const half = words.slice(0, Math.ceil(words.length / 2)).join(' ')
  return {
    success: true,
    result: {
      text: half,
      usage: { inputTokens: words.length, outputTokens: Math.ceil(words.length / 2) },
    },
    attempts: 1,
    totalDelayMs: 0,
  }
})

vi.mock('../ai/stream.server.js', () => ({
  generateTextWithRetry: (...args: unknown[]) => mockGenerateText(...args),
}))

// ── Import after mocks ─────────────────────────────────────────────────────

const { condense } = await import('./condense.js')

// ── Tests ──────────────────────────────────────────────────────────────────

describe('condense', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Restore default mock implementation after clearAllMocks
    mockGenerateText.mockImplementation(async (params: any) => {
      const userMsg = params.messages?.find((m: any) => m.role === 'user')
      const words = (userMsg?.content ?? '').split(/\s+/)
      const half = words.slice(0, Math.ceil(words.length / 2)).join(' ')
      return {
        success: true,
        result: {
          text: half,
          usage: { inputTokens: words.length, outputTokens: Math.ceil(words.length / 2) },
        },
        attempts: 1,
        totalDelayMs: 0,
      }
    })
  })

  it('passes through when input fits target', async () => {
    const text = 'Short text that fits.'
    const result = await condense(text, {
      target: { maxTokens: 100 },
      model: 'openai:mini',
    })

    expect(result.passthrough).toBe(true)
    expect(result.text).toBe(text)
    expect(result.usage.mapCalls).toBe(0)
    expect(result.usage.reduceCalls).toBe(0)
    expect(result.cost.total).toBe(0)
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('applies target priority: maxChars > maxTokens > ratio', async () => {
    // maxChars takes precedence even if maxTokens is also set
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')

    const result = await condense(text, {
      target: { maxChars: 1000, maxTokens: 5, ratio: 0.1 },
      model: 'openai:mini',
    })

    // 1000 chars / 3.5 = ~286 tokens, which is >> 50 words, so passthrough
    expect(result.passthrough).toBe(true)
  })

  it('performs map calls for each chunk', async () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`)
    const text = words.join(' ')

    await condense(text, {
      target: { maxTokens: 10 },
      model: 'openai:mini',
      maxChunkTokens: 20,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
    })

    // 100 words / 20 per chunk = 5 chunks → at least 5 map calls
    expect(mockGenerateText).toHaveBeenCalled()
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(5)
  })

  it('performs recursive reduce when map output exceeds target', async () => {
    // Make map phase produce too much text, requiring reduce
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`)
    const text = words.join(' ')

    const result = await condense(text, {
      target: { maxTokens: 5 },
      model: 'openai:mini',
      maxChunkTokens: 20,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
    })

    expect(result.usage.mapCalls).toBeGreaterThan(0)
    // Each halving in reduce should bring us closer to target
    expect(result.usage.reduceCalls).toBeGreaterThan(0)
    expect(result.passthrough).toBe(false)
  })

  it('respects maxRecursionDepth', async () => {
    // Use a mock that returns text of constant size (no reduction)
    mockGenerateText.mockImplementation(async (params: any) => {
      const userMsg = params.messages?.find((m: any) => m.role === 'user')
      const text = userMsg?.content ?? ''
      return {
        success: true,
        result: {
          text, // Return same size — no reduction
          usage: { inputTokens: 10, outputTokens: 10 },
        },
        attempts: 1,
        totalDelayMs: 0,
      }
    })

    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
    const result = await condense(text, {
      target: { maxTokens: 5 },
      model: 'openai:mini',
      maxChunkTokens: 20,
      overlapTokens: 0,
      maxRecursionDepth: 2,
      chunkStrategy: 'tokens',
    })

    // Should stop after convergence guard (first reduce pass won't shrink)
    // reduceDepth tracks how many passes happened
    expect(result.usage.reduceDepth).toBeLessThanOrEqual(2)
  })

  it('propagates LLM failure', async () => {
    mockGenerateText.mockImplementationOnce(async () => ({
      success: false,
      error: new Error('Rate limit exceeded'),
      attempts: 3,
      totalDelayMs: 5000,
      finalCategory: 'retryable',
    }))

    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')

    await expect(
      condense(text, {
        target: { maxTokens: 5 },
        model: 'openai:mini',
        maxChunkTokens: 20,
        overlapTokens: 0,
        chunkStrategy: 'tokens',
      }),
    ).rejects.toThrow('Rate limit exceeded')
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    controller.abort()

    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')

    await expect(
      condense(text, {
        target: { maxTokens: 5 },
        model: 'openai:mini',
        maxChunkTokens: 20,
        overlapTokens: 0,
        signal: controller.signal,
        chunkStrategy: 'tokens',
      }),
    ).rejects.toThrow()
  })

  it('selects HIGH prompt for aggressive compression (ratio < 10%)', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')

    await condense(text, {
      target: { maxTokens: 5 }, // 5/100 = 5% → HIGH
      model: 'openai:mini',
      maxChunkTokens: 50,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
    })

    const firstCall = mockGenerateText.mock.calls[0]
    expect(firstCall[0].system).toContain('Aggressive text condenser')
  })

  it('selects MEDIUM prompt for moderate compression (10% ≤ ratio < 60%)', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')

    await condense(text, {
      target: { maxTokens: 30 }, // 30/100 = 30% → MEDIUM
      model: 'openai:mini',
      maxChunkTokens: 50,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
    })

    const firstCall = mockGenerateText.mock.calls[0]
    expect(firstCall[0].system).toContain('Thoughtful editor')
  })

  it('selects LOW prompt for light compression (ratio ≥ 60%)', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')

    await condense(text, {
      target: { maxTokens: 70 }, // 70/100 = 70% → LOW
      model: 'openai:mini',
      maxChunkTokens: 50,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
    })

    const firstCall = mockGenerateText.mock.calls[0]
    expect(firstCall[0].system).toContain('Careful line editor')
  })

  it('passes custom prompts through to LLM calls', async () => {
    const customMap = 'Custom map: {text}'
    const customReduce = 'Custom reduce: {text}'
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')

    await condense(text, {
      target: { maxTokens: 5 },
      model: 'openai:mini',
      maxChunkTokens: 20,
      overlapTokens: 0,
      mapUserPrompt: customMap,
      reduceUserPrompt: customReduce,
      chunkStrategy: 'tokens',
    })

    // At least the map calls should use the custom prompt
    const firstCall = mockGenerateText.mock.calls[0]
    const userMsg = firstCall[0].messages.find((m: { role: string }) => m.role === 'user')
    expect(userMsg?.content).toContain('Custom map:')
  })

  it('accumulates cost and usage across calls', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
    const result = await condense(text, {
      target: { maxTokens: 10 },
      model: 'openai:mini',
      maxChunkTokens: 20,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
    })

    expect(result.usage.inputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens).toBeGreaterThan(0)
    expect(result.cost.map).toBeGreaterThan(0)
    expect(result.cost.total).toBeGreaterThanOrEqual(result.cost.map)
    expect(result.model).toBe('gpt-5-mini')
    expect(result.provider).toBe('openai')
  })

  it('computes ratio correctly', async () => {
    const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
    const result = await condense(text, {
      target: { maxTokens: 10 },
      model: 'openai:mini',
      maxChunkTokens: 20,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
    })

    expect(result.ratio).toBeGreaterThan(0)
    expect(result.inputChars).toBe(text.length)
    expect(result.outputChars).toBe(result.text.length)
    expect(result.ratio).toBeCloseTo(result.outputChars / result.inputChars, 5)
  })

  it('fires progress events', async () => {
    const events: unknown[] = []
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')

    await condense(text, {
      target: { maxTokens: 10 },
      model: 'openai:mini',
      maxChunkTokens: 20,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
      onProgress: (e) => events.push(e),
    })

    const phases = events.map((e) => (e as { phase: string }).phase)
    expect(phases).toContain('start')
    expect(phases).toContain('chunk')
    expect(phases).toContain('map')
    expect(phases).toContain('map-done')
    expect(phases).toContain('done')
    expect(phases[phases.length - 1]).toBe('done')
  })

  it('fires done progress event on map-only path (no reduce needed)', async () => {
    // Mock that returns very short summaries so map output fits target
    mockGenerateText.mockImplementation(async () => ({
      success: true,
      result: {
        text: 'short',
        usage: { inputTokens: 10, outputTokens: 1 },
      },
      attempts: 1,
      totalDelayMs: 0,
    }))

    const events: unknown[] = []
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ')

    await condense(text, {
      target: { maxTokens: 40 },
      model: 'openai:mini',
      maxChunkTokens: 20,
      overlapTokens: 0,
      chunkStrategy: 'tokens',
      onProgress: (e) => events.push(e),
    })

    const phases = events.map((e) => (e as { phase: string }).phase)
    expect(phases).toContain('map-done')
    expect(phases).toContain('done')
    expect(phases[phases.length - 1]).toBe('done')
    // Should NOT have any reduce events — map output fits
    expect(phases).not.toContain('reduce')
  })

  it('uses ratio target correctly', async () => {
    const text = Array.from({ length: 10 }, (_, i) => `word${i}`).join(' ')

    // ratio: 1.0 means keep everything → passthrough
    const result = await condense(text, {
      target: { ratio: 1.0 },
      model: 'openai:mini',
    })

    expect(result.passthrough).toBe(true)
  })

  it('throws for empty target', async () => {
    await expect(
      condense('some text', {
        target: {},
        model: 'openai:mini',
      }),
    ).rejects.toThrow('CondenseTarget must specify')
  })
})
