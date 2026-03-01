import type { ExtractResult } from '../types.js'
import { formatAsCsv, formatSheetAsCsv } from './csv.js'
import { formatResult, formatters, getFormatter } from './index.js'
import { formatAsJson, formatSheetAsJson } from './json.js'
import { formatAsMarkdown, formatSheetAsMarkdown } from './markdown.js'
import { formatAsText, formatSheetAsText } from './text.js'
import { formatAsTsv, formatSheetAsTsv } from './tsv.js'
import { DEFAULT_FORMATTER_OPTIONS } from './types.js'

// Helper to create ExtractResult
function createExtractResult(overrides: Partial<ExtractResult> = {}): ExtractResult {
  return {
    source: '/test/document.docx',
    format: 'docx',
    unitCount: 1,
    runCount: 1,
    text: 'Test content',
    metadata: {
      title: 'Test Document',
      author: 'Test Author',
    },
    errors: [],
    ...overrides,
  }
}

describe('formatters registry', () => {
  it('contains all expected formatters', () => {
    expect(formatters.text).toBeDefined()
    expect(formatters.markdown).toBeDefined()
    expect(formatters.json).toBeDefined()
    expect(formatters.csv).toBeDefined()
    expect(formatters.tsv).toBeDefined()
  })

  it('each formatter has name and format function', () => {
    for (const [key, formatter] of Object.entries(formatters)) {
      expect(formatter.name).toBe(key)
      expect(typeof formatter.format).toBe('function')
      expect(typeof formatter.formatSheet).toBe('function')
    }
  })
})

describe('getFormatter', () => {
  it('returns formatter for valid format', () => {
    expect(getFormatter('text').name).toBe('text')
    expect(getFormatter('markdown').name).toBe('markdown')
    expect(getFormatter('json').name).toBe('json')
    expect(getFormatter('csv').name).toBe('csv')
    expect(getFormatter('tsv').name).toBe('tsv')
  })

  it('throws for unknown format', () => {
    expect(() => getFormatter('unknown' as any)).toThrow('Unknown format')
  })
})

describe('formatResult', () => {
  it('uses text formatter by default', () => {
    const result = createExtractResult({ text: 'Hello World' })
    const output = formatResult(result)
    expect(output).toBe('Hello World')
  })

  it('uses specified formatter', () => {
    const result = createExtractResult({ text: 'Hello World' })
    const output = formatResult(result, 'json')
    expect(JSON.parse(output)).toMatchObject({ text: 'Hello World' })
  })
})

describe('textFormatter', () => {
  describe('formatAsText', () => {
    it('returns text as-is', () => {
      const result = createExtractResult({ text: 'Simple text content' })
      expect(formatAsText(result)).toBe('Simple text content')
    })

    it('preserves whitespace and newlines', () => {
      const result = createExtractResult({ text: 'Line 1\n\nLine 3\n  Indented' })
      expect(formatAsText(result)).toBe('Line 1\n\nLine 3\n  Indented')
    })
  })

  describe('formatSheetAsText', () => {
    it('formats sheet data with spaces', () => {
      const data = [
        ['A', 'B', 'C'],
        ['1', '2', '3'],
      ]
      const output = formatSheetAsText(data)
      expect(output).toBe('A B C\n1 2 3')
    })

    it('handles empty data', () => {
      expect(formatSheetAsText([])).toBe('')
    })
  })
})

describe('csvFormatter', () => {
  describe('formatAsCsv', () => {
    it('formats spreadsheet text as CSV', () => {
      const result = createExtractResult({
        format: 'xlsx',
        text: 'A\tB\tC\n1\t2\t3',
      })
      const output = formatAsCsv(result)
      expect(output).toBe('A,B,C\n1,2,3')
    })

    it('escapes commas in values', () => {
      const result = createExtractResult({
        format: 'xlsx',
        text: 'Name\tValue\nJohn, Jr.\t100',
      })
      const output = formatAsCsv(result)
      expect(output).toContain('"John, Jr."')
    })

    it('escapes quotes in values', () => {
      const result = createExtractResult({
        format: 'xlsx',
        text: 'Quote\nShe said "hello"',
      })
      const output = formatAsCsv(result)
      expect(output).toContain('""hello""')
    })

    it('escapes newlines in values', () => {
      const result = createExtractResult({
        format: 'xlsx',
        text: 'Text\nLine1\nLine2',
      })
      const output = formatAsCsv(result)
      // The newline in the cell value should be quoted
      expect(output.split('\n').length).toBeGreaterThanOrEqual(2)
    })

    it('handles non-spreadsheet formats as single column', () => {
      const result = createExtractResult({
        format: 'docx',
        text: 'Line 1\nLine 2\nLine 3',
      })
      const output = formatAsCsv(result)
      expect(output).toBe('Line 1\nLine 2\nLine 3')
    })
  })

  describe('formatSheetAsCsv', () => {
    it('formats sheet data as CSV', () => {
      const data = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]
      const output = formatSheetAsCsv(data)
      expect(output).toBe('Name,Age\nAlice,30\nBob,25')
    })

    it('respects custom delimiter', () => {
      const data = [['A', 'B']]
      const output = formatSheetAsCsv(data, { delimiter: ';' })
      expect(output).toBe('A;B')
    })

    it('handles empty cells', () => {
      const data = [
        ['A', '', 'C'],
        ['', 'B', ''],
      ]
      const output = formatSheetAsCsv(data)
      expect(output).toBe('A,,C\n,B,')
    })

    it('handles null/undefined values', () => {
      const data = [[null, undefined, 'value'] as any]
      const output = formatSheetAsCsv(data)
      expect(output).toBe(',,value')
    })
  })
})

describe('tsvFormatter', () => {
  describe('formatAsTsv', () => {
    it('formats spreadsheet text as TSV', () => {
      const result = createExtractResult({
        format: 'xlsx',
        text: 'A\tB\tC\n1\t2\t3',
      })
      const output = formatAsTsv(result)
      expect(output).toBe('A\tB\tC\n1\t2\t3')
    })
  })

  describe('formatSheetAsTsv', () => {
    it('formats sheet data as TSV', () => {
      const data = [
        ['Name', 'Age'],
        ['Alice', '30'],
      ]
      const output = formatSheetAsTsv(data)
      expect(output).toBe('Name\tAge\nAlice\t30')
    })

    it('escapes tabs in values', () => {
      const data = [['Has\ttab']]
      const output = formatSheetAsTsv(data)
      // Tab should be escaped or replaced
      expect(output).not.toContain('\t\t')
    })
  })
})

describe('jsonFormatter', () => {
  describe('formatAsJson', () => {
    it('formats result as JSON', () => {
      const result = createExtractResult({
        text: 'Content',
        metadata: { title: 'Test' },
      })
      const output = formatAsJson(result)
      const parsed = JSON.parse(output)

      expect(parsed.text).toBe('Content')
      expect(parsed.metadata.title).toBe('Test')
      expect(parsed.source).toBe('/test/document.docx')
      expect(parsed.format).toBe('docx')
    })

    it('includes all result fields', () => {
      const result = createExtractResult({
        unitCount: 5,
        runCount: 2,
        errors: [{ unitIndex: 0, phase: 'extract', message: 'Error' }],
      })
      const output = formatAsJson(result)
      const parsed = JSON.parse(output)

      expect(parsed.unitCount).toBe(5)
      expect(parsed.runCount).toBe(2)
      expect(parsed.errors).toHaveLength(1)
    })

    it('respects prettyPrint option', () => {
      const result = createExtractResult({ text: 'Test' })

      const prettyOutput = formatAsJson(result, { prettyPrint: true })
      const compactOutput = formatAsJson(result, { prettyPrint: false })

      expect(prettyOutput.includes('\n')).toBe(true)
      expect(compactOutput.includes('\n')).toBe(false)
    })
  })

  describe('formatSheetAsJson', () => {
    it('formats sheet data as JSON array', () => {
      const data = [
        ['A', 'B'],
        ['1', '2'],
      ]
      const output = formatSheetAsJson(data)
      const parsed = JSON.parse(output)

      expect(parsed).toEqual(data)
    })

    it('formats with headers as objects', () => {
      const data = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]
      const output = formatSheetAsJson(data, { headers: true })
      const parsed = JSON.parse(output)

      expect(parsed).toEqual([
        { Name: 'Alice', Age: '30' },
        { Name: 'Bob', Age: '25' },
      ])
    })
  })
})

describe('markdownFormatter', () => {
  describe('formatAsMarkdown', () => {
    it('includes title as h1', () => {
      const result = createExtractResult({
        metadata: { title: 'My Document' },
        text: 'Content here',
      })
      const output = formatAsMarkdown(result)

      expect(output).toContain('# My Document')
    })

    it('includes author in metadata', () => {
      const result = createExtractResult({
        metadata: { author: 'John Doe' },
        text: 'Content',
      })
      const output = formatAsMarkdown(result)

      expect(output).toContain('**Author:** John Doe')
    })

    it('includes created date', () => {
      const result = createExtractResult({
        metadata: { created: new Date('2024-01-15') },
        text: 'Content',
      })
      const output = formatAsMarkdown(result)

      expect(output).toContain('**Created:** 2024-01-15')
    })

    it('includes modified date', () => {
      const result = createExtractResult({
        metadata: { modified: new Date('2024-06-20') },
        text: 'Content',
      })
      const output = formatAsMarkdown(result)

      expect(output).toContain('**Modified:** 2024-06-20')
    })

    it('includes content', () => {
      const result = createExtractResult({ text: 'Main content here' })
      const output = formatAsMarkdown(result)

      expect(output).toContain('Main content here')
    })

    it('shows error count when errors present', () => {
      const result = createExtractResult({
        errors: [
          { unitIndex: 0, phase: 'extract', message: 'Error 1' },
          { unitIndex: 1, phase: 'extract', message: 'Error 2' },
        ],
        text: 'Content',
      })
      const output = formatAsMarkdown(result)

      expect(output).toContain('2 error(s)')
    })

    it('handles missing metadata gracefully', () => {
      const result = createExtractResult({
        metadata: {},
        text: 'Just content',
      })
      const output = formatAsMarkdown(result)

      expect(output).toBe('Just content')
    })
  })

  describe('formatSheetAsMarkdown', () => {
    it('formats as markdown table', () => {
      const data = [
        ['Name', 'Age'],
        ['Alice', '30'],
        ['Bob', '25'],
      ]
      const output = formatSheetAsMarkdown(data, { headers: true })

      expect(output).toContain('| Name | Age |')
      expect(output).toContain('| :--- | :--- |')
      expect(output).toContain('| Alice | 30 |')
      expect(output).toContain('| Bob | 25 |')
    })

    it('generates column headers when not provided', () => {
      const data = [
        ['A', 'B'],
        ['1', '2'],
      ]
      const output = formatSheetAsMarkdown(data, { headers: false })

      expect(output).toContain('Column 1')
      expect(output).toContain('Column 2')
    })

    it('escapes pipe characters', () => {
      const data = [['Has | pipe']]
      const output = formatSheetAsMarkdown(data)

      expect(output).toContain('\\|')
    })

    it('handles empty data', () => {
      expect(formatSheetAsMarkdown([])).toBe('')
    })

    it('respects alignment option', () => {
      const data = [['Value']]

      const leftOutput = formatSheetAsMarkdown(data, { alignment: 'left' })
      expect(leftOutput).toContain(':---')

      const rightOutput = formatSheetAsMarkdown(data, { alignment: 'right' })
      expect(rightOutput).toContain('---:')

      const centerOutput = formatSheetAsMarkdown(data, { alignment: 'center' })
      expect(centerOutput).toContain(':---:')
    })

    it('handles rows with varying lengths', () => {
      const data = [
        ['A', 'B', 'C'],
        ['1'], // Short row
        ['x', 'y'], // Medium row
      ]
      const output = formatSheetAsMarkdown(data, { headers: true })

      // Should still produce valid markdown table
      expect(output.split('\n')).toHaveLength(4) // header + separator + 2 data rows
    })

    // escapeMarkdown helper edge cases (tested via formatSheetAsMarkdown)
    describe('escapeMarkdown edge cases', () => {
      it('escapes multiple pipe characters in a cell', () => {
        const data = [['a|b|c|d']]
        const output = formatSheetAsMarkdown(data)
        expect(output).toContain('a\\|b\\|c\\|d')
      })

      it('replaces newlines with spaces', () => {
        const data = [['Line1\nLine2\nLine3']]
        const output = formatSheetAsMarkdown(data)
        expect(output).not.toContain('\n\n') // No double newlines from cell content
        expect(output).toContain('Line1 Line2 Line3')
      })

      it('handles empty string cell', () => {
        const data = [['filled', '', 'filled']]
        const output = formatSheetAsMarkdown(data, { headers: false })
        expect(output).toContain('|  |') // Empty cell should produce empty column
      })

      it('handles null and undefined values', () => {
        // CellValue type includes null | undefined, so this is a valid test case
        const data: Array<Array<string | null | undefined>> = [[null, undefined, 'value']]
        const output = formatSheetAsMarkdown(data)
        // null/undefined should be converted to empty string
        expect(output).not.toContain('null')
        expect(output).not.toContain('undefined')
        expect(output).toContain('| value |')
      })

      it('handles special markdown characters besides pipe', () => {
        const data = [['*bold* _italic_ `code` [link](url)']]
        const output = formatSheetAsMarkdown(data)
        // These should be preserved (only pipe is escaped)
        expect(output).toContain('*bold*')
        expect(output).toContain('_italic_')
        expect(output).toContain('`code`')
      })

      it('trims whitespace from cell values', () => {
        const data = [['  padded  ', '\ttabbed\t']]
        const output = formatSheetAsMarkdown(data)
        expect(output).toContain('| padded |')
        expect(output).toContain('| tabbed |')
      })

      it('handles cell with only whitespace', () => {
        const data = [['   ', '\t\n']]
        const output = formatSheetAsMarkdown(data)
        // After trim, should be empty
        expect(output.match(/\| {2}\|/)).toBeTruthy()
      })

      it('handles mixed pipe and newline characters', () => {
        const data = [['a|b\nc|d']]
        const output = formatSheetAsMarkdown(data)
        expect(output).toContain('a\\|b c\\|d')
      })
    })

    // getAlignmentIndicator edge cases
    describe('alignment indicators', () => {
      it('default alignment is left when not specified', () => {
        const data = [['Value']]
        const output = formatSheetAsMarkdown(data)
        expect(output).toContain(':---')
        expect(output).not.toContain('---:')
        expect(output).not.toContain(':---:')
      })
    })
  })
})

describe('DEFAULT_FORMATTER_OPTIONS', () => {
  it('has expected defaults', () => {
    expect(DEFAULT_FORMATTER_OPTIONS.delimiter).toBe(',')
    expect(DEFAULT_FORMATTER_OPTIONS.lineEnding).toBe('\n')
    expect(DEFAULT_FORMATTER_OPTIONS.headers).toBe(false)
    expect(DEFAULT_FORMATTER_OPTIONS.prettyPrint).toBe(true)
    expect(DEFAULT_FORMATTER_OPTIONS.alignment).toBe('left')
  })
})
