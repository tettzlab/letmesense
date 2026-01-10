/**
 * Tests for document complexity metrics module.
 */

import { describe, expect, it } from 'vitest'
import {
  computeComplexity,
  type DocumentComplexity,
  getComplexityLevel,
  getComplexitySpanAttributes,
} from './complexity.js'
import type { DocumentUnit } from './types.js'

/**
 * Helper to create a mock DocumentUnit with defaults
 */
function createUnit(overrides: Partial<DocumentUnit> = {}): DocumentUnit {
  return {
    index: 0,
    label: 'Page 1',
    kind: 'text-only',
    charCount: 1000,
    language: 'eng',
    textSample: 'Sample text...',
    ...overrides,
  }
}

describe('computeComplexity', () => {
  describe('pageCount', () => {
    it('counts total units', () => {
      const units = [createUnit({ index: 0 }), createUnit({ index: 1 }), createUnit({ index: 2 })]

      const result = computeComplexity(units)
      expect(result.pageCount).toBe(3)
    })

    it('returns 0 for empty units', () => {
      const result = computeComplexity([])
      expect(result.pageCount).toBe(0)
    })
  })

  describe('charCount', () => {
    it('sums character counts from all units', () => {
      const units = [
        createUnit({ charCount: 500 }),
        createUnit({ charCount: 1500 }),
        createUnit({ charCount: 2000 }),
      ]

      const result = computeComplexity(units)
      expect(result.charCount).toBe(4000)
    })

    it('handles zero-char units', () => {
      const units = [createUnit({ charCount: 0 }), createUnit({ charCount: 100 })]

      const result = computeComplexity(units)
      expect(result.charCount).toBe(100)
    })
  })

  describe('imageCount', () => {
    it('counts image-only units', () => {
      const units = [
        createUnit({ kind: 'text-only' }),
        createUnit({ kind: 'image-only' }),
        createUnit({ kind: 'image-only' }),
      ]

      const result = computeComplexity(units)
      expect(result.imageCount).toBe(2)
    })

    it('counts mixed content units', () => {
      const units = [createUnit({ kind: 'text-only' }), createUnit({ kind: 'mixed' })]

      const result = computeComplexity(units)
      expect(result.imageCount).toBe(1)
    })

    it('does not count text-only or empty units', () => {
      const units = [
        createUnit({ kind: 'text-only' }),
        createUnit({ kind: 'empty' }),
        createUnit({ kind: 'tabular' }),
      ]

      const result = computeComplexity(units)
      expect(result.imageCount).toBe(0)
    })
  })

  describe('hasOcr', () => {
    it('is true for image-only units', () => {
      const units = [createUnit({ kind: 'image-only' })]

      const result = computeComplexity(units)
      expect(result.hasOcr).toBe(true)
    })

    it('is true for unknown units with low char count', () => {
      const units = [createUnit({ kind: 'unknown', charCount: 10 })]

      const result = computeComplexity(units)
      expect(result.hasOcr).toBe(true)
    })

    it('is true for mixed units with low char count', () => {
      const units = [createUnit({ kind: 'mixed', charCount: 50 })]

      const result = computeComplexity(units)
      expect(result.hasOcr).toBe(true)
    })

    it('is false for unknown units with high char count', () => {
      const units = [createUnit({ kind: 'unknown', charCount: 1000 })]

      const result = computeComplexity(units)
      expect(result.hasOcr).toBe(false)
    })

    it('is false for text-only documents', () => {
      const units = [createUnit({ kind: 'text-only' }), createUnit({ kind: 'text-only' })]

      const result = computeComplexity(units)
      expect(result.hasOcr).toBe(false)
    })
  })

  describe('hasMixedContent', () => {
    it('is true when document has both text-only and image units', () => {
      const units = [createUnit({ kind: 'text-only' }), createUnit({ kind: 'image-only' })]

      const result = computeComplexity(units)
      expect(result.hasMixedContent).toBe(true)
    })

    it('is true when document has text-only and mixed units', () => {
      const units = [createUnit({ kind: 'text-only' }), createUnit({ kind: 'mixed' })]

      const result = computeComplexity(units)
      expect(result.hasMixedContent).toBe(true)
    })

    it('is false for all text-only documents', () => {
      const units = [createUnit({ kind: 'text-only' }), createUnit({ kind: 'text-only' })]

      const result = computeComplexity(units)
      expect(result.hasMixedContent).toBe(false)
    })

    it('is false for all image-only documents', () => {
      const units = [createUnit({ kind: 'image-only' }), createUnit({ kind: 'image-only' })]

      const result = computeComplexity(units)
      expect(result.hasMixedContent).toBe(false)
    })
  })

  describe('hasTabular', () => {
    it('is true when any unit is tabular', () => {
      const units = [createUnit({ kind: 'text-only' }), createUnit({ kind: 'tabular' })]

      const result = computeComplexity(units)
      expect(result.hasTabular).toBe(true)
    })

    it('is false when no tabular units', () => {
      const units = [createUnit({ kind: 'text-only' }), createUnit({ kind: 'image-only' })]

      const result = computeComplexity(units)
      expect(result.hasTabular).toBe(false)
    })
  })

  describe('score calculation', () => {
    it('calculates score based on weighted factors', () => {
      // 2 pages * 2 = 4
      // 2000 chars / 1000 * 1 = 2
      // No images, OCR, mixed, tabular = 0
      // Total = 6
      const units = [createUnit({ charCount: 1000 }), createUnit({ charCount: 1000 })]

      const result = computeComplexity(units)
      expect(result.score).toBe(6)
    })

    it('adds bonus for OCR content', () => {
      // 1 page * 2 = 2
      // 0 chars = 0
      // 1 image * 5 = 5
      // OCR bonus = 20
      // Total = 27
      const units = [createUnit({ kind: 'image-only', charCount: 0 })]

      const result = computeComplexity(units)
      expect(result.score).toBe(27)
    })

    it('adds bonus for mixed content', () => {
      // 2 pages * 2 = 4
      // 100 chars / 1000 * 1 = 0.1 -> 0
      // 1 image * 5 = 5
      // OCR bonus = 20 (mixed with low chars triggers hasOcr)
      // Mixed bonus = 10
      // Total = 39
      const units = [
        createUnit({ kind: 'text-only', charCount: 50 }),
        createUnit({ kind: 'mixed', charCount: 50 }),
      ]

      const result = computeComplexity(units)
      expect(result.score).toBe(39)
    })

    it('adds bonus for tabular data', () => {
      // 1 page * 2 = 2
      // 500 chars / 1000 * 1 = 0.5 -> 1
      // Tabular bonus = 5
      // Total = 8
      const units = [createUnit({ kind: 'tabular', charCount: 500 })]

      const result = computeComplexity(units)
      expect(result.score).toBe(8)
    })

    it('caps score at 100', () => {
      // Create a highly complex document
      const units = Array.from({ length: 100 }, (_, i) =>
        createUnit({ index: i, kind: 'image-only', charCount: 10000 }),
      )

      const result = computeComplexity(units)
      expect(result.score).toBe(100)
    })

    it('returns 0 for empty document', () => {
      const result = computeComplexity([])
      expect(result.score).toBe(0)
    })
  })
})

describe('getComplexitySpanAttributes', () => {
  const baseComplexity: DocumentComplexity = {
    pageCount: 10,
    charCount: 5000,
    imageCount: 3,
    hasOcr: true,
    hasMixedContent: true,
    hasTabular: false,
    score: 45,
  }

  it('returns all complexity attributes', () => {
    const attrs = getComplexitySpanAttributes(baseComplexity)

    expect(attrs['document.page.count']).toBe(10)
    expect(attrs['document.char.count']).toBe(5000)
    expect(attrs['document.image.count']).toBe(3)
    expect(attrs['document.has_ocr']).toBe(true)
    expect(attrs['document.has_mixed_content']).toBe(true)
    expect(attrs['document.has_tabular']).toBe(false)
    expect(attrs['document.complexity.score']).toBe(45)
  })

  it('includes format when provided', () => {
    const attrs = getComplexitySpanAttributes(baseComplexity, 'pdf')
    expect(attrs['document.format']).toBe('pdf')
  })

  it('omits format when not provided', () => {
    const attrs = getComplexitySpanAttributes(baseComplexity)
    expect(attrs['document.format']).toBeUndefined()
  })
})

describe('getComplexityLevel', () => {
  it('returns low for score < 20', () => {
    expect(getComplexityLevel(0)).toBe('low')
    expect(getComplexityLevel(10)).toBe('low')
    expect(getComplexityLevel(19)).toBe('low')
  })

  it('returns medium for score 20-49', () => {
    expect(getComplexityLevel(20)).toBe('medium')
    expect(getComplexityLevel(35)).toBe('medium')
    expect(getComplexityLevel(49)).toBe('medium')
  })

  it('returns high for score 50-79', () => {
    expect(getComplexityLevel(50)).toBe('high')
    expect(getComplexityLevel(65)).toBe('high')
    expect(getComplexityLevel(79)).toBe('high')
  })

  it('returns very_high for score >= 80', () => {
    expect(getComplexityLevel(80)).toBe('very_high')
    expect(getComplexityLevel(100)).toBe('very_high')
  })
})
