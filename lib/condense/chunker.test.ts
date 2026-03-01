import { type CountTokensFn, chunkMarkdown } from './chunker.js'

/** Simple token counter: 1 token per word */
const countTokens: CountTokensFn = (text: string) => {
  if (!text || !text.trim()) return 0
  return text.split(/\s+/).length
}

describe('chunkMarkdown', () => {
  it('returns empty array for empty input', () => {
    expect(chunkMarkdown('', 100, 'heading', 0, countTokens)).toEqual([])
    expect(chunkMarkdown('   ', 100, 'heading', 0, countTokens)).toEqual([])
  })

  it('returns single chunk when text fits', () => {
    const text = 'Hello world this is a test'
    const chunks = chunkMarkdown(text, 100, 'heading', 0, countTokens)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe(text)
    expect(chunks[0].index).toBe(0)
    expect(chunks[0].tokenCount).toBe(6)
  })

  describe('heading strategy', () => {
    it('splits at heading boundaries', () => {
      const text = [
        '# Section A',
        'Content for section A with several words here.',
        '',
        '# Section B',
        'Content for section B with several words here too.',
      ].join('\n')

      const chunks = chunkMarkdown(text, 8, 'heading', 0, countTokens)
      expect(chunks.length).toBeGreaterThanOrEqual(2)
      expect(chunks[0].text).toContain('Section A')
      expect(chunks[1].text).toContain('Section B')
    })

    it('preserves heading context breadcrumbs', () => {
      const text = [
        '# Chapter 1',
        '',
        '## Section 1.1',
        'Short content.',
        '',
        '## Section 1.2',
        'More short content.',
      ].join('\n')

      const chunks = chunkMarkdown(text, 5, 'heading', 0, countTokens)
      // Children should carry parent heading context
      const sectionChunk = chunks.find((c) => c.text.includes('Section 1.1'))
      expect(sectionChunk).toBeDefined()
      expect(sectionChunk?.headingContext).toContain('Chapter 1')
    })

    it('does not treat headings inside fenced code blocks as sections', () => {
      const text = ['# Real Heading', '```', '# Not a heading', '```', 'Some text here.'].join('\n')

      const chunks = chunkMarkdown(text, 100, 'heading', 0, countTokens)
      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toContain('# Not a heading')
      expect(chunks[0].headingContext).toEqual(['Real Heading'])
    })

    it('falls back to paragraph splitting for oversized leaf sections', () => {
      const text = [
        '# Big Section',
        'Paragraph one with some words here.',
        '',
        'Paragraph two with different words there.',
        '',
        'Paragraph three with even more words now.',
      ].join('\n')

      // Limit small enough to force splitting
      const chunks = chunkMarkdown(text, 6, 'heading', 0, countTokens)
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('falls back to sentence splitting for oversized paragraphs', () => {
      const longParagraph =
        'First sentence here. Second sentence here. Third sentence here. Fourth sentence here.'
      const text = `# Title\n${longParagraph}`

      const chunks = chunkMarkdown(text, 4, 'heading', 0, countTokens)
      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('paragraph strategy', () => {
    it('groups paragraphs up to token limit', () => {
      const text = 'Para one.\n\nPara two.\n\nPara three.\n\nPara four.'

      const chunks = chunkMarkdown(text, 5, 'paragraph', 0, countTokens)
      expect(chunks.length).toBeGreaterThan(1)
      // Each chunk should be under the limit
      for (const c of chunks) {
        expect(c.tokenCount).toBeLessThanOrEqual(5)
      }
    })

    it('has empty heading context', () => {
      const text = 'Para one.\n\nPara two.'
      const chunks = chunkMarkdown(text, 100, 'paragraph', 0, countTokens)
      expect(chunks[0].headingContext).toEqual([])
    })
  })

  describe('token strategy', () => {
    it('splits at word boundaries by token count', () => {
      const words = Array.from({ length: 20 }, (_, i) => `word${i}`)
      const text = words.join(' ')

      const chunks = chunkMarkdown(text, 5, 'tokens', 0, countTokens)
      expect(chunks.length).toBe(4)
      for (const c of chunks) {
        expect(c.tokenCount).toBeLessThanOrEqual(5)
      }
    })
  })

  describe('overlap', () => {
    it('prepends tail of previous chunk to next chunk', () => {
      const text = 'Para one words.\n\nPara two words.\n\nPara three words.'

      const chunks = chunkMarkdown(text, 4, 'paragraph', 2, countTokens)
      expect(chunks.length).toBeGreaterThan(1)

      // First chunk has no overlap
      // Subsequent chunks should contain text from previous chunk
      if (chunks.length > 1) {
        // The second chunk should start with overlap from first
        const firstWords = chunks[0].text.split(/\s+/)
        const overlapWords = firstWords.slice(-2).join(' ')
        expect(chunks[1].text).toContain(overlapWords)
      }
    })

    it('skips overlap when set to 0', () => {
      const text = 'Alpha bravo.\n\nCharlie delta.'
      const withOverlap = chunkMarkdown(text, 3, 'paragraph', 2, countTokens)
      const without = chunkMarkdown(text, 3, 'paragraph', 0, countTokens)

      // With overlap, later chunks are larger
      if (withOverlap.length > 1 && without.length > 1) {
        expect(withOverlap[1].tokenCount).toBeGreaterThanOrEqual(without[1].tokenCount)
      }
    })
  })

  describe('indexing', () => {
    it('assigns sequential indices', () => {
      const text = 'A.\n\nB.\n\nC.\n\nD.'
      const chunks = chunkMarkdown(text, 2, 'paragraph', 0, countTokens)
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].index).toBe(i)
      }
    })
  })
})
