import type { LlmProvider, ModelPricing, StreamEvent } from './types.js'

// Create a mock provider
const mockProvider: LlmProvider = {
  name: 'openai',
  defaultModel: 'gpt-5-nano',
  defaultVisionModel: 'gpt-5-mini',
  isAvailable: vi.fn(() => true),
  getPricing: vi.fn(
    () =>
      ({
        input: 0.05,
        output: 0.4,
        image: null,
      }) as ModelPricing,
  ),
  format: vi.fn(),
  formatStream: vi.fn(),
}

// Mock the provider module
vi.mock('./provider.js', () => ({
  resolveProvider: vi.fn(() => mockProvider),
  getProvider: vi.fn(() => mockProvider),
  buildConfig: vi.fn((provider, partial, vision) => ({
    provider: provider.name,
    model: partial?.model ?? (vision ? provider.defaultVisionModel : provider.defaultModel),
    timeout: partial?.timeout ?? 60000,
    maxRetries: partial?.maxRetries ?? 3,
  })),
}))

// Mock cost module
vi.mock('./cost.js', () => ({
  estimateCost: vi.fn(() => ({
    inputTokens: 1000,
    outputTokens: 1500,
    imageTokens: 0,
    totalCost: 0.05,
    model: 'gpt-5-nano',
    provider: 'openai',
  })),
  calculateCost: vi.fn(() => 0.05),
}))

import {
  DEFAULT_MARKDOWN_PAGE_SEPARATOR,
  estimateFormatCost,
  formatAsMarkdown,
  formatPage,
  formatPageStream,
  formatPages,
  type PageInput,
} from './format.js'
import type { LlmFormatOptions } from './types.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const createPageInput = (overrides?: Partial<PageInput>): PageInput => ({
  text: 'Sample text content',
  pageIndex: 0,
  language: 'eng',
  pageKind: 'born-digital',
  ...overrides,
})

const createOptions = (overrides?: Partial<LlmFormatOptions>): LlmFormatOptions => ({
  format: 'markdown',
  llm: { provider: 'openai' },
  ...overrides,
})

describe('DEFAULT_MARKDOWN_PAGE_SEPARATOR', () => {
  it('is defined', () => {
    expect(DEFAULT_MARKDOWN_PAGE_SEPARATOR).toBe('\n\n---\n\n')
  })
})

describe('estimateFormatCost', () => {
  it('estimates cost for pages', () => {
    const pages = [createPageInput(), createPageInput({ pageIndex: 1 })]
    const options = createOptions()

    const estimate = estimateFormatCost(pages, options)

    expect(estimate.inputTokens).toBe(1000)
    expect(estimate.outputTokens).toBe(1500)
    expect(estimate.totalCost).toBe(0.05)
  })

  it('passes vision flag to cost estimation', () => {
    const pages = [createPageInput({ imageWidth: 1024, imageHeight: 1024 })]
    const options = createOptions({ vision: true })

    const estimate = estimateFormatCost(pages, options)

    expect(estimate).toBeDefined()
  })
})

describe('formatPage', () => {
  beforeEach(() => {
    vi.mocked(mockProvider.format).mockResolvedValue({
      content: 'Formatted markdown',
      usage: { inputTokens: 100, outputTokens: 50 },
    })
  })

  it('formats a single page', async () => {
    const page = createPageInput()
    const options = createOptions()
    const config = {
      provider: 'openai' as const,
      model: 'gpt-5-nano',
      timeout: 60000,
      maxRetries: 3,
    }

    const result = await formatPage(page, 5, '', options, config)

    expect(result.pageIndex).toBe(0)
    expect(result.content).toBe('Formatted markdown')
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)
    expect(mockProvider.format).toHaveBeenCalled()
  })

  it('includes previous tail for continuity', async () => {
    const page = createPageInput({ pageIndex: 2 })
    const options = createOptions()
    const config = {
      provider: 'openai' as const,
      model: 'gpt-5-nano',
      timeout: 60000,
      maxRetries: 3,
    }

    await formatPage(page, 5, 'previous content ending...', options, config)

    expect(mockProvider.format).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          previousTail: 'previous content ending...',
        }),
      }),
      expect.any(Object),
    )
  })

  it('includes image for vision mode', async () => {
    const page = createPageInput({
      image: 'data:image/png;base64,abc123',
      imageWidth: 1024,
      imageHeight: 1024,
    })
    const options = createOptions({ vision: true })
    const config = {
      provider: 'openai' as const,
      model: 'gpt-5-mini',
      timeout: 60000,
      maxRetries: 3,
    }

    await formatPage(page, 1, '', options, config)

    expect(mockProvider.format).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'data:image/png;base64,abc123',
      }),
      expect.any(Object),
    )
  })

  it('excludes image when vision is false', async () => {
    const page = createPageInput({
      image: 'data:image/png;base64,abc123',
    })
    const options = createOptions({ vision: false })
    const config = {
      provider: 'openai' as const,
      model: 'gpt-5-nano',
      timeout: 60000,
      maxRetries: 3,
    }

    await formatPage(page, 1, '', options, config)

    expect(mockProvider.format).toHaveBeenCalledWith(
      expect.objectContaining({
        image: undefined,
      }),
      expect.any(Object),
    )
  })
})

describe('formatPageStream', () => {
  beforeEach(() => {
    vi.mocked(mockProvider.formatStream).mockResolvedValue({
      content: 'Streamed content',
      usage: { inputTokens: 100, outputTokens: 50 },
    })
  })

  it('formats a page with streaming', async () => {
    const page = createPageInput()
    const options = createOptions()
    const config = {
      provider: 'openai' as const,
      model: 'gpt-5-nano',
      timeout: 60000,
      maxRetries: 3,
    }
    const onChunk = vi.fn()

    const result = await formatPageStream(page, 5, '', options, config, onChunk)

    expect(result.content).toBe('Streamed content')
    expect(mockProvider.formatStream).toHaveBeenCalled()
  })
})

describe('formatPages', () => {
  beforeEach(() => {
    vi.mocked(mockProvider.format).mockResolvedValue({
      content: 'Formatted page',
      usage: { inputTokens: 100, outputTokens: 50 },
    })
    vi.mocked(mockProvider.formatStream).mockImplementation(async (_req, _cfg, onChunk) => {
      onChunk('Chunk 1')
      onChunk('Chunk 2')
      return {
        content: 'Chunk 1Chunk 2',
        usage: { inputTokens: 100, outputTokens: 50 },
      }
    })
  })

  it('formats multiple pages', async () => {
    const pages = [createPageInput({ pageIndex: 0 }), createPageInput({ pageIndex: 1 })]
    const options = createOptions()

    const result = await formatPages(pages, options)

    expect(result.pages).toHaveLength(2)
    expect(result.content).toContain('Formatted page')
    expect(result.totalUsage.inputTokens).toBe(200)
    expect(result.totalUsage.outputTokens).toBe(100)
  })

  it('joins pages with separator', async () => {
    const pages = [createPageInput({ pageIndex: 0 }), createPageInput({ pageIndex: 1 })]
    const options = createOptions()

    const result = await formatPages(pages, options)

    expect(result.content).toContain(DEFAULT_MARKDOWN_PAGE_SEPARATOR)
  })

  it('emits progress events', async () => {
    const pages = [createPageInput({ pageIndex: 0 }), createPageInput({ pageIndex: 1 })]
    const events: StreamEvent[] = []
    const options = createOptions({
      onProgress: (event) => events.push(event),
    })

    await formatPages(pages, options)

    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toContain('start')
    expect(eventTypes).toContain('page-start')
    expect(eventTypes).toContain('content')
    expect(eventTypes).toContain('page-done')
    expect(eventTypes).toContain('done')
  })

  it('emits start event with cost estimate', async () => {
    const pages = [createPageInput()]
    const events: StreamEvent[] = []
    const options = createOptions({
      onProgress: (event) => events.push(event),
    })

    await formatPages(pages, options)

    const startEvent = events.find((e) => e.type === 'start')
    expect(startEvent).toBeDefined()
    if (startEvent?.type === 'start') {
      expect(startEvent.totalPages).toBe(1)
      expect(startEvent.estimatedCost).toBeDefined()
    }
  })

  it('emits error event on failure', async () => {
    vi.mocked(mockProvider.formatStream).mockRejectedValue(new Error('API Error'))

    const pages = [createPageInput()]
    const events: StreamEvent[] = []
    const options = createOptions({
      onProgress: (event) => events.push(event),
    })

    await expect(formatPages(pages, options)).rejects.toThrow('API Error')

    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toBeDefined()
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.message).toBe('API Error')
      expect(errorEvent.pageIndex).toBe(0)
    }
  })

  it('uses non-streaming mode when no onProgress', async () => {
    const pages = [createPageInput()]
    const options = createOptions()

    await formatPages(pages, options)

    expect(mockProvider.format).toHaveBeenCalled()
    expect(mockProvider.formatStream).not.toHaveBeenCalled()
  })

  it('maintains previousTail across pages', async () => {
    vi.mocked(mockProvider.format)
      .mockResolvedValueOnce({
        content: 'First page content ends with this tail',
        usage: { inputTokens: 100, outputTokens: 50 },
      })
      .mockResolvedValueOnce({
        content: 'Second page',
        usage: { inputTokens: 100, outputTokens: 50 },
      })

    const pages = [createPageInput({ pageIndex: 0 }), createPageInput({ pageIndex: 1 })]
    const options = createOptions()

    await formatPages(pages, options)

    // Second call should have previousTail from first page
    const calls = vi.mocked(mockProvider.format).mock.calls
    expect(calls[1][0].context?.previousTail).toContain('tail')
  })
})

describe('formatAsMarkdown', () => {
  beforeEach(() => {
    vi.mocked(mockProvider.format).mockResolvedValue({
      content: 'Markdown output',
      usage: { inputTokens: 100, outputTokens: 50 },
    })
  })

  it('formats pages as markdown', async () => {
    const pages = [createPageInput()]
    const options = createOptions()

    const result = await formatAsMarkdown(pages, options)

    expect(result.content).toBe('Markdown output')
  })

  it('throws for non-markdown format', async () => {
    const pages = [createPageInput()]
    const options = { ...createOptions(), format: 'text' as never }

    await expect(formatAsMarkdown(pages, options)).rejects.toThrow('Invalid format: text')
  })

  it('returns document result structure', async () => {
    const pages = [createPageInput(), createPageInput({ pageIndex: 1 })]
    const options = createOptions()

    const result = await formatAsMarkdown(pages, options)

    expect(result).toHaveProperty('content')
    expect(result).toHaveProperty('pages')
    expect(result).toHaveProperty('totalUsage')
    expect(result.pages).toHaveLength(2)
  })
})
