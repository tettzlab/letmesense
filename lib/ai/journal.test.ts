import { existsSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  calculateEntryCost,
  createFileJournal,
  createJournalEntry,
  createMarkdownJournal,
  formatEntryAsMarkdown,
  generateEntryId,
  getJournalPath,
  getMarkdownJournalPath,
  sanitizeExperimentName,
} from './journal.js'
import type {
  CostBreakdown,
  ImageContext,
  OfficeUnitContext,
  PageContext,
  TokenUsage,
} from './types.js'

// Helper to create TokenUsage for tests
const createTokenUsage = (
  input: number,
  output: number,
  details?: Partial<TokenUsage>,
): TokenUsage => ({
  inputTokens: input,
  outputTokens: output,
  ...details,
})

// Helper to create CostBreakdown for tests
const createCostBreakdown = (total: number, details?: Partial<CostBreakdown>): CostBreakdown => ({
  total,
  ...details,
})

const createPageContext = (overrides?: Partial<PageContext>): PageContext => ({
  text: 'Sample text content',
  page: 1,
  totalPages: 10,
  language: 'eng',
  pageKind: 'born-digital',
  previousTail: 'previous page ending...',
  runIndex: 0,
  ...overrides,
})

const createOfficeContext = (overrides?: Partial<OfficeUnitContext>): OfficeUnitContext => ({
  unitIndex: 0,
  unitLabel: 'Slide 1',
  format: 'pptx',
  totalUnits: 5,
  contentKind: 'text-rich',
  text: 'Slide content here',
  ...overrides,
})

const createImageContext = (overrides?: Partial<ImageContext>): ImageContext => ({
  filePath: '/path/to/image.png',
  width: 1024,
  height: 768,
  mimeType: 'image/png',
  text: '',
  ...overrides,
})

describe('generateEntryId', () => {
  it('generates ID in expected format', () => {
    const id = generateEntryId()

    // Format: YYYYMMDD-HHmmss-xxxxxxxx
    expect(id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateEntryId())
    }
    expect(ids.size).toBe(100)
  })
})

describe('calculateEntryCost', () => {
  it('calculates cost correctly', () => {
    const tokens = { inputTokens: 1000, outputTokens: 500 }
    const pricing = { input: 3.0, output: 15.0, image: null }

    const cost = calculateEntryCost(tokens, pricing)

    // (1000/1M)*3 + (500/1M)*15 = 0.003 + 0.0075 = 0.0105
    expect(cost.total).toBeCloseTo(0.0105, 5)
    expect(cost.input).toBeCloseTo(0.003, 6)
    expect(cost.output).toBeCloseTo(0.0075, 6)
  })

  it('handles zero tokens', () => {
    const tokens = { inputTokens: 0, outputTokens: 0 }
    const pricing = { input: 3.0, output: 15.0, image: null }

    const cost = calculateEntryCost(tokens, pricing)

    expect(cost.total).toBe(0)
  })

  it('handles cached tokens with discount', () => {
    const tokens = {
      inputTokens: 1000,
      outputTokens: 500,
      inputDetails: { cached: 400, uncached: 600 },
    }
    const pricing = { input: 3.0, output: 15.0, image: null }

    const cost = calculateEntryCost(tokens, pricing)

    // Uncached: (600/1M)*3 = 0.0018
    // Cached at 10%: (400/1M)*3*0.1 = 0.00012
    // Output: (500/1M)*15 = 0.0075
    // Total: 0.0018 + 0.00012 + 0.0075 = 0.00942
    expect(cost.total).toBeCloseTo(0.00942, 5)
    expect(cost.cached).toBeCloseTo(0.00012, 6)
  })

  it('handles reasoning tokens', () => {
    const tokens = {
      inputTokens: 1000,
      outputTokens: 500,
      outputDetails: { reasoning: 200, text: 300 },
    }
    const pricing = { input: 3.0, output: 15.0, image: null }

    const cost = calculateEntryCost(tokens, pricing)

    // Input: (1000/1M)*3 = 0.003
    // Text output: (300/1M)*15 = 0.0045
    // Reasoning: (200/1M)*15 = 0.003
    // Total: 0.003 + 0.0045 + 0.003 = 0.0105
    expect(cost.total).toBeCloseTo(0.0105, 5)
    expect(cost.reasoning).toBeCloseTo(0.003, 6)
  })
})

describe('createJournalEntry', () => {
  it('creates entry with all fields', () => {
    const context = createPageContext()
    const entry = createJournalEntry({
      experiment: 'test-experiment',
      provider: 'openai',
      model: 'gpt-5-mini',
      promptTemplate: 'Format this: {text}',
      prompt: 'Format this: Sample text content',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'Formatted output',
      tokens: createTokenUsage(100, 50),
      cost: createCostBreakdown(0.001),
      durationMs: 500,
    })

    expect(entry.id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{8}$/)
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(entry.experiment).toBe('test-experiment')
    expect(entry.provider).toBe('openai')
    expect(entry.model).toBe('gpt-5-mini')
    expect(entry.promptTemplate).toBe('Format this: {text}')
    expect(entry.prompt).toBe('Format this: Sample text content')
    expect(entry.input.text).toBe('Sample text content')
    expect(entry.input.hasImage).toBe(false)
    expect(entry.input.hasPdf).toBe(false)
    expect(entry.context).toBe(context)
    expect(entry.output).toBe('Formatted output')
    expect(entry.tokens.input).toBe(100)
    expect(entry.tokens.output).toBe(50)
    expect(entry.cost.total).toBe(0.001)
    expect(entry.durationMs).toBe(500)
  })

  it('includes optional fields when provided', () => {
    const context = createPageContext()
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-mini',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: true,
      hasPdf: false,
      output: 'output',
      tokens: createTokenUsage(0, 0),
      cost: createCostBreakdown(0),
      durationMs: 0,
      retries: 2,
      error: 'Rate limit exceeded',
    })

    expect(entry.retries).toBe(2)
    expect(entry.error).toBe('Rate limit exceeded')
  })

  it('creates entry with OfficeUnitContext', () => {
    const context = createOfficeContext()
    const entry = createJournalEntry({
      experiment: 'office-test',
      provider: 'anthropic',
      model: 'claude-sonnet',
      promptTemplate: 'Extract content from this office document',
      prompt: 'Extract content from this office document',
      context,
      hasImage: true,
      hasPdf: false,
      output: '# Slide 1\n\nContent from slide',
      tokens: createTokenUsage(200, 100),
      cost: createCostBreakdown(0.005),
      durationMs: 800,
    })

    expect(entry.experiment).toBe('office-test')
    expect(entry.context).toBe(context)
    expect(entry.input.text).toBe('Slide content here')
    expect(entry.input.hasImage).toBe(true)
    expect((entry.context as OfficeUnitContext).unitLabel).toBe('Slide 1')
    expect((entry.context as OfficeUnitContext).format).toBe('pptx')
    expect((entry.context as OfficeUnitContext).totalUnits).toBe(5)
  })

  it('creates entry with ImageContext', () => {
    const context = createImageContext()
    const entry = createJournalEntry({
      experiment: 'image-test',
      provider: 'openai',
      model: 'gpt-5.2',
      promptTemplate: 'Describe this image',
      prompt: 'Describe this image',
      context,
      hasImage: true,
      hasPdf: false,
      output: 'This image shows a landscape with mountains',
      tokens: createTokenUsage(1500, 200),
      cost: createCostBreakdown(0.02),
      durationMs: 1200,
    })

    expect(entry.experiment).toBe('image-test')
    expect(entry.context).toBe(context)
    expect(entry.input.text).toBe('') // Images have no extracted text
    expect(entry.input.hasImage).toBe(true)
    expect((entry.context as ImageContext).filePath).toBe('/path/to/image.png')
    expect((entry.context as ImageContext).width).toBe(1024)
    expect((entry.context as ImageContext).height).toBe(768)
    expect((entry.context as ImageContext).mimeType).toBe('image/png')
  })
})

describe('getJournalPath', () => {
  it('returns correct path', () => {
    const path = getJournalPath('./experiments', 'my-experiment')
    expect(path).toBe('experiments/my-experiment.jsonl')
  })

  it('handles absolute paths', () => {
    const path = getJournalPath('/tmp/experiments', 'test')
    expect(path).toBe('/tmp/experiments/test.jsonl')
  })

  it('sanitizes experiment name', () => {
    const path = getJournalPath('./experiments', 'My Experiment!')
    expect(path).toBe('experiments/my-experiment.jsonl')
  })
})

describe('sanitizeExperimentName', () => {
  it('converts to lowercase', () => {
    expect(sanitizeExperimentName('MyExperiment')).toBe('myexperiment')
  })

  it('replaces spaces with dashes', () => {
    expect(sanitizeExperimentName('my experiment name')).toBe('my-experiment-name')
  })

  it('replaces special characters with dashes', () => {
    expect(sanitizeExperimentName('test@experiment!')).toBe('test-experiment')
  })

  it('collapses multiple dashes', () => {
    expect(sanitizeExperimentName('test---experiment')).toBe('test-experiment')
  })

  it('removes leading and trailing dashes', () => {
    expect(sanitizeExperimentName('-test-')).toBe('test')
    expect(sanitizeExperimentName('---test---')).toBe('test')
  })

  it('preserves valid characters', () => {
    expect(sanitizeExperimentName('test-experiment_v1')).toBe('test-experiment_v1')
  })

  it('limits length to 100 characters', () => {
    const longName = 'a'.repeat(150)
    expect(sanitizeExperimentName(longName).length).toBeLessThanOrEqual(100)
  })
})

describe('createFileJournal', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `journal-test-${Date.now()}`)
  })

  afterEach(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  it('creates directory if it does not exist', async () => {
    const journal = await createFileJournal(testDir, 'test')

    expect(existsSync(testDir)).toBe(true)
    expect(typeof journal).toBe('function')
  })

  it('appends entries as JSONL', async () => {
    const journal = await createFileJournal(testDir, 'test')
    const context = createPageContext()

    const entry1 = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output 1',
      tokens: createTokenUsage(10, 5),
      cost: createCostBreakdown(0.001),
      durationMs: 100,
    })

    const entry2 = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output 2',
      tokens: createTokenUsage(20, 10),
      cost: createCostBreakdown(0.002),
      durationMs: 200,
    })

    await journal(entry1)
    await journal(entry2)

    const filePath = join(testDir, 'test.jsonl')
    const content = await readFile(filePath, 'utf-8')
    const lines = content.trim().split('\n')

    expect(lines.length).toBe(2)

    const parsed1 = JSON.parse(lines[0])
    const parsed2 = JSON.parse(lines[1])

    expect(parsed1.output).toBe('output 1')
    expect(parsed2.output).toBe('output 2')
  })

  it('creates valid JSON for each line', async () => {
    const journal = await createFileJournal(testDir, 'json-test')
    const context = createPageContext({ text: 'Text with "quotes" and\nnewlines' })

    const entry = createJournalEntry({
      experiment: 'json-test',
      provider: 'anthropic',
      model: 'claude-sonnet',
      promptTemplate: 'Template with {text}',
      prompt: 'Template with text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'Output with special chars: \t\r\n"quotes"',
      tokens: createTokenUsage(50, 25),
      cost: createCostBreakdown(0.005),
      durationMs: 300,
    })

    await journal(entry)

    const filePath = join(testDir, 'json-test.jsonl')
    const content = await readFile(filePath, 'utf-8')

    // Should not throw when parsing
    const parsed = JSON.parse(content.trim())
    expect(parsed.experiment).toBe('json-test')
    expect(parsed.context.text).toBe('Text with "quotes" and\nnewlines')
    expect(parsed.output).toContain('special chars')
  })

  it('sanitizes experiment name for filename', async () => {
    const journal = await createFileJournal(testDir, 'My Experiment!')
    const context = createPageContext()

    const entry = createJournalEntry({
      experiment: 'My Experiment!',
      provider: 'openai',
      model: 'gpt-5',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output',
      tokens: createTokenUsage(10, 5),
      cost: createCostBreakdown(0.001),
      durationMs: 100,
    })

    await journal(entry)

    // File should be created with sanitized name
    const filePath = join(testDir, 'my-experiment.jsonl')
    expect(existsSync(filePath)).toBe(true)
  })

  it('throws on empty experiment name after sanitization', async () => {
    await expect(createFileJournal(testDir, '!!!')).rejects.toThrow('Invalid experiment name')
  })

  it('prevents path traversal in experiment name', async () => {
    const journal = await createFileJournal(testDir, '../../../etc/passwd')
    const context = createPageContext()

    const entry = createJournalEntry({
      experiment: '../../../etc/passwd',
      provider: 'openai',
      model: 'gpt-5',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output',
      tokens: createTokenUsage(10, 5),
      cost: createCostBreakdown(0.001),
      durationMs: 100,
    })

    await journal(entry)

    // File should be in testDir, not anywhere else
    const filePath = join(testDir, 'etc-passwd.jsonl')
    expect(existsSync(filePath)).toBe(true)
    // Original path should not exist
    expect(existsSync('/etc/passwd.jsonl')).toBe(false)
  })
})

describe('formatEntryAsMarkdown', () => {
  it('formats entry with all fields', () => {
    const context = createPageContext()
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: 'Sample text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'Formatted output',
      tokens: createTokenUsage(100, 50),
      cost: createCostBreakdown(0.001234),
      durationMs: 500,
      finishReason: 'stop',
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('## Entry')
    expect(markdown).toContain('openai/gpt-5-nano')
    expect(markdown).toContain('500ms')
    expect(markdown).toContain('100 in / 50 out')
    expect(markdown).toContain('$0.001234')
    expect(markdown).toContain('stop ✓')
    expect(markdown).toContain('### Prompt Template')
    expect(markdown).toContain('{text}')
    expect(markdown).toContain('### Extracted Text')
    expect(markdown).toContain('Sample text content')
    expect(markdown).toContain('### Output')
    expect(markdown).toContain('Formatted output')
  })

  it('shows warning icon for length finish reason', () => {
    const context = createPageContext()
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: '',
      tokens: createTokenUsage(100, 1024),
      cost: createCostBreakdown(0.001),
      durationMs: 500,
      finishReason: 'length',
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('⚠️')
    expect(markdown).toContain('length ⚠️ (hit token limit)')
  })

  it('shows warning for content_filter finish reason', () => {
    const context = createPageContext()
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: '',
      tokens: createTokenUsage(100, 0),
      cost: createCostBreakdown(0.001),
      durationMs: 500,
      finishReason: 'content_filter',
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('content_filter ⚠️ (blocked)')
  })

  it('shows empty indicator for empty output', () => {
    const context = createPageContext()
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: '',
      tokens: createTokenUsage(100, 0),
      cost: createCostBreakdown(0.001),
      durationMs: 500,
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('_(empty)_')
  })

  it('makes long content collapsible', () => {
    const longText = 'a'.repeat(600)
    const context = createPageContext({ text: longText })
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: longText,
      context,
      hasImage: false,
      hasPdf: false,
      output: longText,
      tokens: createTokenUsage(200, 200),
      cost: createCostBreakdown(0.001),
      durationMs: 500,
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('<details>')
    expect(markdown).toContain('click to expand')
    expect(markdown).toContain('</details>')
  })

  it('formats PageContext correctly', () => {
    const context = createPageContext({ page: 5, totalPages: 20, language: 'jpn' })
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output',
      tokens: createTokenUsage(10, 5),
      cost: createCostBreakdown(0.001),
      durationMs: 100,
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('**Page:** 5/20')
    expect(markdown).toContain('**Language:** jpn')
  })

  it('formats OfficeUnitContext correctly', () => {
    const context = createOfficeContext({ unitLabel: 'Sheet 3', format: 'xlsx' })
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output',
      tokens: createTokenUsage(10, 5),
      cost: createCostBreakdown(0.001),
      durationMs: 100,
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('**Unit:** Sheet 3')
    expect(markdown).toContain('**Format:** xlsx')
  })

  it('formats ImageContext correctly', () => {
    const context = createImageContext({ width: 1920, height: 1080 })
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: true,
      hasPdf: false,
      output: 'output',
      tokens: createTokenUsage(10, 5),
      cost: createCostBreakdown(0.001),
      durationMs: 100,
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('**File:** /path/to/image.png')
    expect(markdown).toContain('**Dimensions:** 1920×1080')
  })

  it('includes rawMeta as collapsible JSON', () => {
    const context = createPageContext()
    const entry = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5-nano',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output',
      tokens: createTokenUsage(10, 5),
      cost: createCostBreakdown(0.001),
      durationMs: 100,
      rawMeta: { responseId: 'chatcmpl-123', modelId: 'gpt-5-nano' },
    })

    const markdown = formatEntryAsMarkdown(entry)

    expect(markdown).toContain('Raw Metadata')
    expect(markdown).toContain('responseId')
    expect(markdown).toContain('chatcmpl-123')
  })
})

describe('getMarkdownJournalPath', () => {
  it('returns correct path with .md extension', () => {
    const path = getMarkdownJournalPath('./experiments', 'my-experiment')
    expect(path).toBe('experiments/my-experiment.md')
  })

  it('sanitizes experiment name', () => {
    const path = getMarkdownJournalPath('./experiments', 'My Experiment!')
    expect(path).toBe('experiments/my-experiment.md')
  })
})

describe('createMarkdownJournal', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `journal-md-test-${Date.now()}`)
  })

  afterEach(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  it('creates directory and file with header', async () => {
    await createMarkdownJournal(testDir, 'test')

    expect(existsSync(testDir)).toBe(true)

    const filePath = join(testDir, 'test.md')
    expect(existsSync(filePath)).toBe(true)

    const content = await readFile(filePath, 'utf-8')
    expect(content).toContain('# Experiment: test')
  })

  it('appends entries as markdown', async () => {
    const journal = await createMarkdownJournal(testDir, 'test')
    const context = createPageContext()

    const entry1 = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output 1',
      tokens: createTokenUsage(10, 5),
      cost: createCostBreakdown(0.001),
      durationMs: 100,
      finishReason: 'stop',
    })

    const entry2 = createJournalEntry({
      experiment: 'test',
      provider: 'openai',
      model: 'gpt-5',
      promptTemplate: '{text}',
      prompt: 'text',
      context,
      hasImage: false,
      hasPdf: false,
      output: 'output 2',
      tokens: createTokenUsage(20, 10),
      cost: createCostBreakdown(0.002),
      durationMs: 200,
      finishReason: 'stop',
    })

    await journal(entry1)
    await journal(entry2)

    const filePath = join(testDir, 'test.md')
    const content = await readFile(filePath, 'utf-8')

    expect(content).toContain('output 1')
    expect(content).toContain('output 2')
    expect(content.match(/## Entry/g)?.length).toBe(2)
  })

  it('does not duplicate header on subsequent calls', async () => {
    await createMarkdownJournal(testDir, 'test')
    await createMarkdownJournal(testDir, 'test')

    const filePath = join(testDir, 'test.md')
    const content = await readFile(filePath, 'utf-8')

    // Should only have one header
    expect(content.match(/# Experiment: test/g)?.length).toBe(1)
  })

  it('throws on empty experiment name after sanitization', async () => {
    await expect(createMarkdownJournal(testDir, '!!!')).rejects.toThrow('Invalid experiment name')
  })
})
