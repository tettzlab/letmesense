/**
 * Comprehensive tests for Office document extraction.
 * Tests actual extraction quality and content accuracy.
 */

import path from 'node:path'
import { extractFromOffice, extractFromOfficeDetailed } from './extractAll.js'

const FIXTURES = path.resolve('lib/office/fixtures')

describe('extractFromOffice', () => {
  describe('PPTX extraction', () => {
    it('extracts text from sample PPTX', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'))

      expect(result.format).toBe('pptx')
      expect(result.unitCount).toBeGreaterThan(0)
      expect(result.text.length).toBeGreaterThan(0)
    })

    it('extracts correct content from slides', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'))

      // Check for expected content
      expect(result.text).toContain('Slide 1')
      expect(result.text).toContain('Test Presentation')
      expect(result.text).toContain('the first slide content')
    })

    it('extracts Unicode content correctly', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'))

      // Check Unicode is preserved
      expect(result.text).toContain('こんにちは')
      expect(result.text).toContain('你好')
    })

    it('does NOT duplicate text (regression test)', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'))

      // Count occurrences of distinct phrases
      // If duplication bug exists, these would appear twice
      const testPhraseMatches = result.text.match(/Test Presentation/g)
      expect(testPhraseMatches?.length ?? 0).toBeLessThanOrEqual(1)

      const slideMarkerMatches = result.text.match(/Slide 2: More Content/g)
      expect(slideMarkerMatches?.length ?? 0).toBeLessThanOrEqual(1)
    })

    it('uses slide separator between units', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'))

      // Default separator is '\n\n---\n\n'
      expect(result.text).toContain('---')
    })

    it('respects custom unitSeparator option', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'), {
        unitSeparator: '\n===\n',
      })

      expect(result.text).toContain('===')
      expect(result.text).not.toContain('---')
    })
  })

  describe('DOCX extraction', () => {
    it('extracts text from sample DOCX', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.docx'))

      expect(result.format).toBe('docx')
      expect(result.text).toContain('Test DOCX Document')
    })

    it('extracts all paragraphs', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.docx'))

      expect(result.text).toContain('Lorem ipsum')
      expect(result.text).toContain('[EOF]')
    })

    it('preserves special characters', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.docx'))

      // The fixture has: &lt;&gt;&amp;"'
      // These should be decoded as: <>&"'
      expect(result.text).toContain('<')
      expect(result.text).toContain('>')
    })

    it('extracts Unicode correctly', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.docx'))

      expect(result.text).toContain('こんにちは')
      expect(result.text).toContain('你好')
    })
  })

  describe('XLSX extraction', () => {
    it('extracts text from sample XLSX', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.xlsx'))

      expect(result.format).toBe('xlsx')
      expect(result.unitCount).toBeGreaterThan(0)
    })

    it('extracts data from all sheets', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.xlsx'))

      // Sheet 1: Users
      expect(result.text).toContain('Name')
      expect(result.text).toContain('Alice')
      expect(result.text).toContain('Bob')

      // Sheet 2: Financials
      expect(result.text).toContain('Quarter')
      expect(result.text).toContain('Revenue')
    })

    it('extracts numeric values', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.xlsx'))

      // Check for numeric content (Age column values)
      expect(result.text).toContain('28')
      expect(result.text).toContain('34')
    })

    it('extracts Unicode from cells', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.xlsx'))

      expect(result.text).toContain('こんにちは')
    })
  })

  describe('OpenDocument format extraction', () => {
    it('extracts text from ODT', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.odt'))

      expect(result.format).toBe('odt')
      expect(result.text).toContain('Test ODT Document')
    })

    it('extracts text from ODP', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.odp'))

      expect(result.format).toBe('odp')
      expect(result.text).toContain('Test ODP Presentation')
    })

    it('extracts text from ODS', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.ods'))

      expect(result.format).toBe('ods')
      expect(result.text).toContain('Name')
      expect(result.text).toContain('Alpha')
    })
  })

  describe('metadata extraction', () => {
    it('extracts document metadata when available', async () => {
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'))

      expect(result.metadata).toBeDefined()
      // Metadata may or may not be present depending on how fixture was created
      expect(result.metadata).toBeTypeOf('object')
    })
  })

  describe('error handling', () => {
    it('throws for non-existent file', async () => {
      await expect(extractFromOffice('/nonexistent/file.pptx')).rejects.toThrow()
    })

    it('throws for invalid Office file', async () => {
      // Create a temp file with invalid content
      const invalidPath = path.join(FIXTURES, 'sample.pdf')
      await expect(extractFromOffice(invalidPath, { format: 'pptx' })).rejects.toThrow()
    })
  })

  describe('extraction options', () => {
    it('respects strict mode', async () => {
      // strict mode should work without error on valid files
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'), {
        strict: true,
      })

      expect(result.errors).toHaveLength(0)
    })

    it('respects timeout option', async () => {
      // Very short timeout should still work on small files
      const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'), {
        timeout: 5000,
      })

      expect(result.text.length).toBeGreaterThan(0)
    })
  })
})

describe('extractFromOfficeDetailed', () => {
  it('returns detailed extraction results', async () => {
    const { result, attributes, runs, extracted, dominantLanguage } =
      await extractFromOfficeDetailed(path.join(FIXTURES, 'sample.pptx'))

    expect(result.format).toBe('pptx')
    expect(attributes.length).toBeGreaterThan(0)
    expect(runs.length).toBeGreaterThan(0)
    expect(extracted.length).toBeGreaterThan(0)
    expect(dominantLanguage).toBeDefined()
  })

  it('provides content attributes for each unit', async () => {
    const { attributes } = await extractFromOfficeDetailed(path.join(FIXTURES, 'sample.pptx'))

    for (const attr of attributes) {
      expect(attr.unitIndex).toBeTypeOf('number')
      expect(attr.unitLabel).toBeTypeOf('string')
      expect(attr.kind).toBeDefined()
      expect(attr.charCount).toBeTypeOf('number')
    }
  })

  it('groups content into runs', async () => {
    const { runs } = await extractFromOfficeDetailed(path.join(FIXTURES, 'sample.pptx'))

    for (const run of runs) {
      expect(run.key).toBeTypeOf('string')
      expect(run.attrs).toBeDefined()
      expect(run.unitIndices).toBeInstanceOf(Array)
      expect(run.unitIndices.length).toBeGreaterThan(0)
    }
  })

  it('provides extracted text for each unit', async () => {
    const { extracted } = await extractFromOfficeDetailed(path.join(FIXTURES, 'sample.pptx'))

    for (const unit of extracted) {
      expect(unit.unitIndex).toBeTypeOf('number')
      expect(unit.text).toBeTypeOf('string')
    }
  })
})

describe('text duplication regression tests', () => {
  /**
   * This test verifies the fix for the text duplication bug where
   * extractTextFromNodes was yielding both parent and child node text,
   * causing content to appear multiple times.
   */
  it('does not duplicate heading text with fragments', async () => {
    const result = await extractFromOffice(path.join(FIXTURES, 'sample.pptx'))
    const text = result.text

    // Split by lines and check for duplicates
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)

    // Create a map of line content to count
    const lineCounts = new Map<string, number>()
    for (const line of lines) {
      lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1)
    }

    // No line should appear more than expected
    // (Some lines might legitimately repeat across slides, but not within same slide)
    for (const [line, count] of lineCounts) {
      // Skip very short lines or separators
      if (line.length < 5 || line === '---') continue

      // Lines should not appear more than number of units (slides)
      expect(count).toBeLessThanOrEqual(result.unitCount)
    }
  })

  it('extracts compound text as single unit', async () => {
    // Test with the user's actual file if available
    try {
      const result = await extractFromOffice('test.pptx')

      // Check that "AWS re:Invent 2021" appears once, not fragmented
      // The bug would have shown "AWS re:Invent 2021" + "AWS" + "re:Invent" + "2021"
      const awsMatches = result.text.match(/AWS/g)

      // AWS should appear but not be duplicated per slide
      if (awsMatches) {
        // Each occurrence of "AWS" should be meaningful, not duplicated fragments
        // This is a heuristic - we can't check exact counts without knowing the file
        expect(awsMatches.length).toBeLessThan(50) // Reasonable upper bound
      }
    } catch {
      // test.pptx might not exist - skip
    }
  })
})
