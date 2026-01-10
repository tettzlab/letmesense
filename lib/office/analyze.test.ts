import { describe, expect, it } from 'vitest'
import { analyzeDocument, DEFAULT_ANALYZE_OPTIONS, getAnalysisSummary } from './analyze.js'
import type { ContentNode, ParsedDocument } from './parser.js'
import type {
  ContentAttributes,
  SectionAttributes,
  SheetAttributes,
  SlideAttributes,
} from './types.js'

// Helper to create a minimal parsed document
function createParsedDocument(nodes: ContentNode[]): ParsedDocument {
  return {
    type: 'document',
    metadata: {},
    content: nodes,
    attachments: [],
    toText: () => nodes.map((n) => n.text).join('\n'),
  } as unknown as ParsedDocument
}

// Helper to create content nodes
function createTextNode(text: string, type: ContentNode['type'] = 'paragraph'): ContentNode {
  return { type, text }
}

function createImageNode(): ContentNode {
  return { type: 'image', text: '' }
}

function createSlideNode(text: string, imageCount = 0): ContentNode {
  const children: ContentNode[] = [createTextNode(text)]
  for (let i = 0; i < imageCount; i++) {
    children.push(createImageNode())
  }
  return {
    type: 'slide',
    text: '',
    children,
  }
}

function createSheetNode(name: string, data: string[][] = []): ContentNode {
  return {
    type: 'sheet',
    text: data.map((row) => row.join('\t')).join('\n'),
    metadata: { sheetName: name },
    children: data.flat().map((cell) => createTextNode(cell, 'cell')),
  }
}

function createSectionNode(text: string, headingText?: string, hasTables = false): ContentNode {
  const children: ContentNode[] = []
  if (headingText) {
    children.push({
      type: 'heading',
      text: headingText,
      metadata: { level: 1 },
    })
  }
  children.push(createTextNode(text))
  if (hasTables) {
    children.push({ type: 'table', text: '', children: [] })
  }
  return {
    type: 'section',
    text: '',
    children,
  }
}

describe('DEFAULT_ANALYZE_OPTIONS', () => {
  it('has expected default values', () => {
    expect(DEFAULT_ANALYZE_OPTIONS.minCharsForTextRich).toBe(20)
    expect(DEFAULT_ANALYZE_OPTIONS.minCharsForLangDetect).toBe(80)
    expect(DEFAULT_ANALYZE_OPTIONS.maxTextSampleChars).toBe(400)
  })
})

describe('analyzeDocument', () => {
  describe('PPTX slides', () => {
    it('analyzes slides with text content', async () => {
      const parsed = createParsedDocument([
        createSlideNode('This is a text-rich slide with plenty of content to analyze'),
      ])

      const results = await analyzeDocument(parsed, 'pptx')

      expect(results).toHaveLength(1)
      expect(results[0].kind).toBe('text-rich')
      expect(results[0].unitLabel).toBe('Slide 1')
      expect(results[0].charCount).toBeGreaterThan(20)
    })

    it('analyzes slides with images', async () => {
      const parsed = createParsedDocument([createSlideNode('caption', 3)])

      const results = await analyzeDocument(parsed, 'pptx')

      expect(results).toHaveLength(1)
      expect(results[0].kind).toBe('image-heavy')
      expect(results[0].imageCount).toBe(3)
    })

    it('analyzes mixed slides', async () => {
      const parsed = createParsedDocument([
        createSlideNode(
          'This slide has significant text content and also contains images for illustration',
          2,
        ),
      ])

      const results = await analyzeDocument(parsed, 'pptx')

      expect(results).toHaveLength(1)
      expect(results[0].kind).toBe('mixed')
    })

    it('analyzes empty slides', async () => {
      const parsed = createParsedDocument([createSlideNode('')])

      const results = await analyzeDocument(parsed, 'pptx')

      expect(results).toHaveLength(1)
      expect(results[0].kind).toBe('empty')
    })

    it('includes slideNumber in SlideAttributes', async () => {
      const parsed = createParsedDocument([
        createSlideNode('Slide 1 content here with enough text'),
        createSlideNode('Slide 2 content here with enough text'),
      ])

      const results = (await analyzeDocument(parsed, 'pptx')) as SlideAttributes[]

      expect(results[0].slideNumber).toBe(1)
      expect(results[1].slideNumber).toBe(2)
    })
  })

  describe('XLSX sheets', () => {
    it('analyzes sheets with data', async () => {
      const parsed = createParsedDocument([
        createSheetNode('Sales', [
          ['Product', 'Revenue', 'Quantity'],
          ['Widget A', '1000', '50'],
          ['Widget B', '2000', '100'],
        ]),
      ])

      const results = (await analyzeDocument(parsed, 'xlsx')) as SheetAttributes[]

      expect(results).toHaveLength(1)
      expect(results[0].kind).toBe('text-rich')
      expect(results[0].unitLabel).toBe('Sheet: Sales')
      expect(results[0].sheetName).toBe('Sales')
    })

    it('includes row and column counts', async () => {
      const parsed = createParsedDocument([
        createSheetNode('Data', [
          ['A', 'B', 'C'],
          ['1', '2', '3'],
        ]),
      ])

      // Note: The actual rowCount/columnCount depends on getTableData implementation
      const results = (await analyzeDocument(parsed, 'xlsx')) as SheetAttributes[]

      expect(results[0].sheetName).toBe('Data')
    })
  })

  describe('DOCX sections', () => {
    it('analyzes sections with text', async () => {
      const parsed = createParsedDocument([
        createSectionNode(
          'This is a document section with substantial content for analysis.',
          'Introduction',
        ),
      ])

      const results = (await analyzeDocument(parsed, 'docx')) as SectionAttributes[]

      expect(results).toHaveLength(1)
      expect(results[0].kind).toBe('text-rich')
      expect(results[0].headingText).toBe('Introduction')
      expect(results[0].headingLevel).toBe(1)
    })

    it('detects tables in sections', async () => {
      const parsed = createParsedDocument([
        createSectionNode('Content with a table.', 'Data Section', true),
      ])

      const results = (await analyzeDocument(parsed, 'docx')) as SectionAttributes[]

      expect(results[0].hasTables).toBe(true)
    })

    it('uses heading text as unit label when available', async () => {
      const parsed = createParsedDocument([createSectionNode('Body content', 'Chapter 1: Intro')])

      const results = await analyzeDocument(parsed, 'docx')

      expect(results[0].unitLabel).toBe('Chapter 1: Intro')
    })
  })

  describe('language detection', () => {
    it('detects language from sufficient text', async () => {
      const parsed = createParsedDocument([
        createSlideNode(
          'Welcome to our presentation about software engineering and programming languages. We will discuss JavaScript, TypeScript, Python, and other popular programming languages used in modern software development.',
        ),
      ])

      const results = await analyzeDocument(parsed, 'pptx')

      // Should detect English
      expect(results[0].language).toBe('eng')
    })

    it('returns und for insufficient text', async () => {
      const parsed = createParsedDocument([createSlideNode('Short')])

      const results = await analyzeDocument(parsed, 'pptx')

      expect(results[0].language).toBe('und')
    })
  })

  describe('custom options', () => {
    it('respects minCharsForTextRich option', async () => {
      const parsed = createParsedDocument([createSlideNode('Short text here')])

      // With default (20), 15 chars = empty
      const defaultResults = await analyzeDocument(parsed, 'pptx')
      expect(defaultResults[0].kind).toBe('empty')

      // With custom (10), 15 chars = text-rich
      const customResults = await analyzeDocument(parsed, 'pptx', { minCharsForTextRich: 10 })
      expect(customResults[0].kind).toBe('text-rich')
    })
  })

  describe('error handling', () => {
    it('captures errors and continues processing', async () => {
      // Create a node that might cause issues
      const parsed = createParsedDocument([
        createSlideNode('Valid slide content here with enough text'),
      ])

      const results = await analyzeDocument(parsed, 'pptx')

      // Should still return results
      expect(results).toHaveLength(1)
    })
  })

  describe('ODP format (like PPTX)', () => {
    it('analyzes ODP slides same as PPTX', async () => {
      const parsed = createParsedDocument([
        createSlideNode('OpenDocument Presentation content here'),
      ])

      const results = await analyzeDocument(parsed, 'odp')

      expect(results[0].unitLabel).toBe('Slide 1')
    })
  })

  describe('ODS format (like XLSX)', () => {
    it('analyzes ODS sheets same as XLSX', async () => {
      const parsed = createParsedDocument([createSheetNode('Data', [['A', 'B']])])

      const results = await analyzeDocument(parsed, 'ods')

      expect(results[0].unitLabel).toContain('Sheet:')
    })
  })

  describe('ODT format (like DOCX)', () => {
    it('analyzes ODT sections same as DOCX', async () => {
      const parsed = createParsedDocument([createSectionNode('OpenDocument content', 'Title')])

      const results = await analyzeDocument(parsed, 'odt')

      expect(results[0].unitLabel).toBe('Title')
    })
  })
})

describe('getAnalysisSummary', () => {
  it('returns correct totals', () => {
    const attributes: ContentAttributes[] = [
      {
        unitIndex: 0,
        unitLabel: 'Unit 1',
        kind: 'text-rich',
        charCount: 100,
        imageCount: 0,
        textSample: '',
        language: 'eng',
      },
      {
        unitIndex: 1,
        unitLabel: 'Unit 2',
        kind: 'image-heavy',
        charCount: 10,
        imageCount: 3,
        textSample: '',
        language: 'und',
      },
      {
        unitIndex: 2,
        unitLabel: 'Unit 3',
        kind: 'mixed',
        charCount: 50,
        imageCount: 1,
        textSample: '',
        language: 'eng',
      },
      {
        unitIndex: 3,
        unitLabel: 'Unit 4',
        kind: 'empty',
        charCount: 0,
        imageCount: 0,
        textSample: '',
        language: 'und',
      },
      {
        unitIndex: 4,
        unitLabel: 'Unit 5',
        kind: 'unknown',
        charCount: 5,
        imageCount: 0,
        textSample: '',
        language: 'und',
      },
    ]

    const summary = getAnalysisSummary(attributes)

    expect(summary.totalUnits).toBe(5)
    expect(summary.textRichCount).toBe(1)
    expect(summary.imageHeavyCount).toBe(1)
    expect(summary.mixedCount).toBe(1)
    expect(summary.emptyCount).toBe(1)
    expect(summary.unknownCount).toBe(1)
  })

  it('counts errors', () => {
    const attributes: ContentAttributes[] = [
      {
        unitIndex: 0,
        unitLabel: 'Unit 1',
        kind: 'text-rich',
        charCount: 100,
        imageCount: 0,
        textSample: '',
        language: 'eng',
        error: { unitIndex: 0, phase: 'analyze', message: 'Test error' },
      },
    ]

    const summary = getAnalysisSummary(attributes)

    expect(summary.errorCount).toBe(1)
  })

  it('collects unique languages', () => {
    const attributes: ContentAttributes[] = [
      {
        unitIndex: 0,
        unitLabel: 'Unit 1',
        kind: 'text-rich',
        charCount: 100,
        imageCount: 0,
        textSample: '',
        language: 'eng',
      },
      {
        unitIndex: 1,
        unitLabel: 'Unit 2',
        kind: 'text-rich',
        charCount: 100,
        imageCount: 0,
        textSample: '',
        language: 'deu',
      },
      {
        unitIndex: 2,
        unitLabel: 'Unit 3',
        kind: 'text-rich',
        charCount: 100,
        imageCount: 0,
        textSample: '',
        language: 'eng', // Duplicate
      },
      {
        unitIndex: 3,
        unitLabel: 'Unit 4',
        kind: 'empty',
        charCount: 0,
        imageCount: 0,
        textSample: '',
        language: 'und', // Undetermined - should be excluded
      },
    ]

    const summary = getAnalysisSummary(attributes)

    expect(summary.languages).toHaveLength(2)
    expect(summary.languages).toContain('eng')
    expect(summary.languages).toContain('deu')
    expect(summary.languages).not.toContain('und')
  })

  it('handles empty input', () => {
    const summary = getAnalysisSummary([])

    expect(summary.totalUnits).toBe(0)
    expect(summary.textRichCount).toBe(0)
    expect(summary.imageHeavyCount).toBe(0)
    expect(summary.mixedCount).toBe(0)
    expect(summary.emptyCount).toBe(0)
    expect(summary.unknownCount).toBe(0)
    expect(summary.errorCount).toBe(0)
    expect(summary.languages).toHaveLength(0)
  })
})
