// Mock the AI SDK modules before importing
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}))

import { generateText, streamText } from 'ai'
import { createGenericProvider } from './genericProvider.js'
import type { ProviderAdapter, RawUsageInfo } from './providerAdapters.js'
import type { FormatRequest, LlmConfig, PageContext, TokenUsage } from './types.js'

// Helper to create async iterator
async function* mockAsyncIterator(chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk
  }
}

const createMockContext = (): PageContext => ({
  text: 'Test content',
  page: 1,
  totalPages: 5,
  language: 'eng',
  pageKind: 'born-digital',
  previousTail: '',
  runIndex: 0,
})

function createMockAdapter(overrides?: Partial<ProviderAdapter>): ProviderAdapter {
  return {
    id: 'openai',
    createLanguageModel: vi.fn().mockReturnValue({ model: 'mock-model' }),
    extractUsage: vi.fn(
      ({ usage }: RawUsageInfo): TokenUsage => ({
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      }),
    ),
    isAvailable: vi.fn().mockReturnValue(true),
    ...overrides,
  }
}

function createMockConfig(overrides?: Partial<LlmConfig>): LlmConfig {
  return {
    provider: 'openai',
    model: 'gpt-5-mini',
    timeout: 60000,
    maxRetries: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createGenericProvider', () => {
  describe('provider properties', () => {
    it('has correct name from adapter', () => {
      const adapter = createMockAdapter({ id: 'anthropic' })
      const provider = createGenericProvider(adapter)
      expect(provider.name).toBe('anthropic')
    })

    it('delegates isAvailable to adapter', () => {
      const adapter = createMockAdapter()
      const provider = createGenericProvider(adapter)
      expect(provider.isAvailable()).toBe(true)
      expect(adapter.isAvailable).toHaveBeenCalled()
    })
  })

  describe('format', () => {
    it('calls generateText and returns formatted response', async () => {
      const adapter = createMockAdapter()

      vi.mocked(generateText).mockResolvedValue({
        text: 'Formatted output',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        finishReason: 'stop',
        providerMetadata: {},
        response: { id: 'resp-1', modelId: 'gpt-5-mini', timestamp: new Date() },
      } as any)

      const provider = createGenericProvider(adapter)
      const request: FormatRequest = { text: 'Hello world', context: createMockContext() }
      const config = createMockConfig()

      const result = await provider.format(request, config)

      expect(result.content).toBe('Formatted output')
      expect(result.usage.inputTokens).toBe(100)
      expect(result.usage.outputTokens).toBe(50)
      expect(result.finishReason).toBe('stop')
      expect(adapter.createLanguageModel).toHaveBeenCalledWith(config, 'gpt-5-mini')
    })

    it('calls beforeFormat when defined', async () => {
      const beforeFormat = vi.fn().mockResolvedValue(undefined)
      const adapter = createMockAdapter({ beforeFormat })

      vi.mocked(generateText).mockResolvedValue({
        text: 'Output',
        usage: { inputTokens: 10, outputTokens: 10 },
      } as any)

      const provider = createGenericProvider(adapter)
      const config = createMockConfig()

      await provider.format({ text: 'Test', context: createMockContext() }, config)

      expect(beforeFormat).toHaveBeenCalledWith(config)
    })

    it('applies spanAttributes from adapter', async () => {
      const spanAttributes = vi.fn().mockReturnValue({ host: 'http://local:11434' })
      const adapter = createMockAdapter({ id: 'ollama', spanAttributes })

      vi.mocked(generateText).mockResolvedValue({
        text: 'Output',
        usage: { inputTokens: 10, outputTokens: 10 },
      } as any)

      const provider = createGenericProvider(adapter)
      const config = createMockConfig({ provider: 'ollama' })

      await provider.format({ text: 'Test', context: createMockContext() }, config)

      expect(spanAttributes).toHaveBeenCalledWith(config)
    })

    it('extracts usage via adapter', async () => {
      const extractUsage = vi.fn().mockReturnValue({
        inputTokens: 100,
        outputTokens: 50,
        inputDetails: { cached: 30, uncached: 70 },
      })
      const adapter = createMockAdapter({ extractUsage })

      vi.mocked(generateText).mockResolvedValue({
        text: 'Output',
        usage: { inputTokens: 100, outputTokens: 50 },
        providerMetadata: { openai: { cachedPromptTokens: 30 } },
      } as any)

      const provider = createGenericProvider(adapter)
      const result = await provider.format(
        { text: 'Test', context: createMockContext() },
        createMockConfig(),
      )

      expect(extractUsage).toHaveBeenCalled()
      expect(result.usage.inputDetails?.cached).toBe(30)
    })

    it('includes rawMeta in response', async () => {
      const adapter = createMockAdapter()
      const timestamp = new Date('2025-01-01T00:00:00Z')

      vi.mocked(generateText).mockResolvedValue({
        text: 'Output',
        usage: { inputTokens: 10, outputTokens: 10, raw: { some: 'data' } },
        providerMetadata: { test: true },
        response: { id: 'resp-123', modelId: 'gpt-5-mini', timestamp },
      } as any)

      const provider = createGenericProvider(adapter)
      const result = await provider.format(
        { text: 'Test', context: createMockContext() },
        createMockConfig(),
      )

      expect(result.rawMeta?.responseId).toBe('resp-123')
      expect(result.rawMeta?.modelId).toBe('gpt-5-mini')
      expect(result.rawMeta?.timestamp).toBe('2025-01-01T00:00:00.000Z')
      expect(result.rawMeta?.rawUsage).toEqual({ some: 'data' })
    })
  })

  describe('formatStream', () => {
    it('streams content and calls onChunk', async () => {
      const adapter = createMockAdapter()
      const chunks = ['Hello ', 'world', '!']

      vi.mocked(streamText).mockReturnValue({
        textStream: mockAsyncIterator(chunks),
        usage: Promise.resolve({ inputTokens: 50, outputTokens: 30 }),
        finishReason: Promise.resolve('stop'),
        response: Promise.resolve({ id: 'resp-1', modelId: 'gpt-5-mini' }),
        providerMetadata: Promise.resolve({}),
      } as any)

      const provider = createGenericProvider(adapter)
      const onChunk = vi.fn()
      const result = await provider.formatStream(
        { text: 'Test', context: createMockContext() },
        createMockConfig(),
        onChunk,
      )

      expect(onChunk).toHaveBeenCalledTimes(3)
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello ')
      expect(onChunk).toHaveBeenNthCalledWith(2, 'world')
      expect(onChunk).toHaveBeenNthCalledWith(3, '!')
      expect(result.content).toBe('Hello world!')
      expect(result.usage.inputTokens).toBe(50)
      expect(result.usage.outputTokens).toBe(30)
    })

    it('calls beforeFormat when defined', async () => {
      const beforeFormat = vi.fn().mockResolvedValue(undefined)
      const adapter = createMockAdapter({ beforeFormat })

      vi.mocked(streamText).mockReturnValue({
        textStream: mockAsyncIterator(['Ok']),
        usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
        finishReason: Promise.resolve('stop'),
        response: Promise.resolve({}),
        providerMetadata: Promise.resolve({}),
      } as any)

      const provider = createGenericProvider(adapter)
      const config = createMockConfig()

      await provider.formatStream({ text: 'Test', context: createMockContext() }, config, vi.fn())

      expect(beforeFormat).toHaveBeenCalledWith(config)
    })
  })

  describe('vision handling', () => {
    it('sends image part when image is provided', async () => {
      const adapter = createMockAdapter()

      vi.mocked(generateText).mockResolvedValue({
        text: 'Vision output',
        usage: { inputTokens: 200, outputTokens: 100 },
      } as any)

      const provider = createGenericProvider(adapter)
      const request: FormatRequest = {
        text: 'Image content',
        image: 'data:image/png;base64,abc123',
        context: createMockContext(),
      }

      const result = await provider.format(request, createMockConfig())

      expect(result.content).toBe('Vision output')
      // Verify generateText was called with system/user separation
      const call = vi.mocked(generateText).mock.calls[0][0] as any
      expect(call.system).toBeDefined()
      expect(call.system).toContain('content safety rules (always apply')
      expect(call.messages[0].content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'image', image: expect.any(Buffer) }),
        ]),
      )
    })
  })

  describe('prompt injection mitigation', () => {
    it('separates system prompt from user content', async () => {
      const adapter = createMockAdapter()

      vi.mocked(generateText).mockResolvedValue({
        text: 'Output',
        usage: { inputTokens: 10, outputTokens: 10 },
      } as any)

      const provider = createGenericProvider(adapter)
      await provider.format(
        { text: 'Test content', context: createMockContext() },
        createMockConfig(),
      )

      const call = vi.mocked(generateText).mock.calls[0][0] as any
      expect(call.system).toBeDefined()
      expect(call.system).toContain('content safety rules (always apply')
      // User message should contain wrapped document text
      const userContent =
        typeof call.messages[0].content === 'string'
          ? call.messages[0].content
          : call.messages[0].content[0].text
      expect(userContent).toMatch(/<lms:document_text_[a-f0-9]{8}>/)
    })
  })

  describe('error handling', () => {
    it('throws parsed error on API failure', async () => {
      const adapter = createMockAdapter()

      vi.mocked(generateText).mockRejectedValue(new Error('API error'))

      const provider = createGenericProvider(adapter)

      await expect(
        provider.format({ text: 'Test', context: createMockContext() }, createMockConfig()),
      ).rejects.toThrow()
    })
  })
})
