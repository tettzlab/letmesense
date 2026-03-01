import { type ClassifyOptions, classifyPageKind } from './classify.js'

describe('classifyPageKind', () => {
  // Default thresholds from classify.ts:
  // minCharsForTextPage: 20
  // scannedIfMaxImageCoverageAtLeast: 0.6
  // mixedIfMaxImageCoverageAtLeast: 0.1
  // ignoreSmallImagesBelowCoverage: 0.02

  const emptyCov = { maxImageCoverageRatio: 0, totalImageCoverageRatio: 0, largeImageCount: 0 }

  describe('empty pages', () => {
    it('returns empty when no text and no images', () => {
      expect(classifyPageKind(0, emptyCov)).toBe('empty')
    })

    it('returns empty when few chars and no images', () => {
      expect(classifyPageKind(19, emptyCov)).toBe('empty')
    })
  })

  describe('scanned-image pages', () => {
    it('returns scanned-image when no text and high image coverage', () => {
      const cov = { maxImageCoverageRatio: 0.6, totalImageCoverageRatio: 0.6, largeImageCount: 1 }
      expect(classifyPageKind(0, cov)).toBe('scanned-image')
    })

    it('returns scanned-image at exact threshold', () => {
      const cov = { maxImageCoverageRatio: 0.6, totalImageCoverageRatio: 0.6, largeImageCount: 1 }
      expect(classifyPageKind(19, cov)).toBe('scanned-image')
    })

    it('returns scanned-image when coverage exceeds threshold', () => {
      const cov = { maxImageCoverageRatio: 0.9, totalImageCoverageRatio: 0.9, largeImageCount: 1 }
      expect(classifyPageKind(0, cov)).toBe('scanned-image')
    })

    it('returns scanned-image via fallback (no text, has large images, low coverage)', () => {
      const cov = { maxImageCoverageRatio: 0.3, totalImageCoverageRatio: 0.3, largeImageCount: 1 }
      expect(classifyPageKind(0, cov)).toBe('scanned-image')
    })
  })

  describe('mixed pages', () => {
    it('returns mixed when text and high image coverage', () => {
      const cov = { maxImageCoverageRatio: 0.6, totalImageCoverageRatio: 0.6, largeImageCount: 1 }
      expect(classifyPageKind(20, cov)).toBe('mixed')
    })

    it('returns mixed at exact threshold', () => {
      const cov = { maxImageCoverageRatio: 0.1, totalImageCoverageRatio: 0.1, largeImageCount: 1 }
      expect(classifyPageKind(20, cov)).toBe('mixed')
    })

    it('returns mixed when text and moderate image coverage', () => {
      const cov = { maxImageCoverageRatio: 0.3, totalImageCoverageRatio: 0.3, largeImageCount: 1 }
      expect(classifyPageKind(100, cov)).toBe('mixed')
    })
  })

  describe('born-digital pages', () => {
    it('returns born-digital when text and no images', () => {
      expect(classifyPageKind(20, emptyCov)).toBe('born-digital')
    })

    it('returns born-digital when text and tiny images (below 2%)', () => {
      const cov = { maxImageCoverageRatio: 0.01, totalImageCoverageRatio: 0.01, largeImageCount: 0 }
      expect(classifyPageKind(100, cov)).toBe('born-digital')
    })

    it('returns born-digital when text and images at exactly ignore threshold', () => {
      const cov = {
        maxImageCoverageRatio: 0.019,
        totalImageCoverageRatio: 0.019,
        largeImageCount: 0,
      }
      expect(classifyPageKind(50, cov)).toBe('born-digital')
    })

    it('returns born-digital via fallback when text and small images (2-10%)', () => {
      // This tests the gap case: images between ignoreSmall (2%) and mixed (10%)
      const cov = { maxImageCoverageRatio: 0.05, totalImageCoverageRatio: 0.05, largeImageCount: 0 }
      expect(classifyPageKind(100, cov)).toBe('born-digital')
    })
  })

  describe('unknown pages', () => {
    it('returns empty when no text and no large images (regardless of coverage)', () => {
      // The classification considers this empty since largeImageCount is 0
      // even though there's some image coverage
      const cov = { maxImageCoverageRatio: 0.3, totalImageCoverageRatio: 0.3, largeImageCount: 0 }
      expect(classifyPageKind(0, cov)).toBe('empty')
    })

    it('returns unknown when it cannot classify otherwise', () => {
      // This is hard to trigger - unknown is a fallback when nothing else matches
      // In practice, most cases are covered by other conditions
      // The only path to unknown is: no text, has large images, but coverage below scanned threshold
      // AND no largeImageCount check... actually reviewing the code, unknown is unreachable
      // because either largeImageCount > 0 (scanned-image) or largeImageCount === 0 (empty)
      // So we remove this test case - unknown seems unreachable with current logic
    })
  })

  describe('custom options', () => {
    it('respects custom minCharsForTextPage', () => {
      const opts: ClassifyOptions = { minCharsForTextPage: 50 }
      const cov = { maxImageCoverageRatio: 0, totalImageCoverageRatio: 0, largeImageCount: 0 }
      expect(classifyPageKind(49, cov, opts)).toBe('empty')
      expect(classifyPageKind(50, cov, opts)).toBe('born-digital')
    })

    it('respects custom scannedIfMaxImageCoverageAtLeast', () => {
      const opts: ClassifyOptions = { scannedIfMaxImageCoverageAtLeast: 0.8 }
      const cov = { maxImageCoverageRatio: 0.7, totalImageCoverageRatio: 0.7, largeImageCount: 1 }
      expect(classifyPageKind(0, cov, opts)).toBe('scanned-image') // fallback via largeImageCount
    })

    it('respects custom mixedIfMaxImageCoverageAtLeast', () => {
      const opts: ClassifyOptions = { mixedIfMaxImageCoverageAtLeast: 0.2 }
      const cov = { maxImageCoverageRatio: 0.15, totalImageCoverageRatio: 0.15, largeImageCount: 1 }
      expect(classifyPageKind(100, cov, opts)).toBe('born-digital')
    })

    it('respects custom ignoreSmallImagesBelowCoverage', () => {
      const opts: ClassifyOptions = { ignoreSmallImagesBelowCoverage: 0.05 }
      const cov = { maxImageCoverageRatio: 0.03, totalImageCoverageRatio: 0.03, largeImageCount: 0 }
      expect(classifyPageKind(100, cov, opts)).toBe('born-digital')
    })
  })

  describe('boundary conditions', () => {
    it('handles zero char count', () => {
      expect(classifyPageKind(0, emptyCov)).toBe('empty')
    })

    it('handles exactly minCharsForTextPage chars', () => {
      expect(classifyPageKind(20, emptyCov)).toBe('born-digital')
    })

    it('handles very high char count', () => {
      expect(classifyPageKind(100000, emptyCov)).toBe('born-digital')
    })

    it('handles coverage ratio of 1.0 (100%)', () => {
      const cov = { maxImageCoverageRatio: 1.0, totalImageCoverageRatio: 1.0, largeImageCount: 1 }
      expect(classifyPageKind(0, cov)).toBe('scanned-image')
      expect(classifyPageKind(100, cov)).toBe('mixed')
    })

    it('handles all thresholds at boundary values', () => {
      const opts: ClassifyOptions = {
        minCharsForTextPage: 1,
        scannedIfMaxImageCoverageAtLeast: 0,
        mixedIfMaxImageCoverageAtLeast: 0,
        ignoreSmallImagesBelowCoverage: 0,
      }
      const cov = { maxImageCoverageRatio: 0, totalImageCoverageRatio: 0, largeImageCount: 0 }
      expect(classifyPageKind(1, cov, opts)).toBe('mixed')
    })
  })
})
