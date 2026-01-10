import { describe, expect, it } from 'vitest'
import {
  CLASSIFICATION_DEFAULTS,
  classifyContentKind,
  classifyWithCoverage,
  describeContentKind,
  mightBenefitFromOcr,
  requiresOcr,
} from './classify.js'

describe('CLASSIFICATION_DEFAULTS', () => {
  it('has expected default values', () => {
    expect(CLASSIFICATION_DEFAULTS.minCharsForTextRich).toBe(20)
    expect(CLASSIFICATION_DEFAULTS.minImagesForImageContent).toBe(1)
    expect(CLASSIFICATION_DEFAULTS.imageHeavyMaxChars).toBe(50)
  })
})

describe('classifyContentKind', () => {
  describe('empty classification', () => {
    it('classifies as empty when no text and no images', () => {
      expect(classifyContentKind({ charCount: 0, imageCount: 0 })).toBe('empty')
    })

    it('classifies as empty when minimal text and no images', () => {
      // Below minCharsForTextRich (20) with no images
      expect(classifyContentKind({ charCount: 10, imageCount: 0 })).toBe('empty')
      expect(classifyContentKind({ charCount: 19, imageCount: 0 })).toBe('empty')
    })
  })

  describe('text-rich classification', () => {
    it('classifies as text-rich when significant text and no images', () => {
      expect(classifyContentKind({ charCount: 20, imageCount: 0 })).toBe('text-rich')
      expect(classifyContentKind({ charCount: 100, imageCount: 0 })).toBe('text-rich')
      expect(classifyContentKind({ charCount: 1000, imageCount: 0 })).toBe('text-rich')
    })

    it('classifies as text-rich at exact threshold', () => {
      expect(classifyContentKind({ charCount: 20, imageCount: 0 })).toBe('text-rich')
    })
  })

  describe('image-heavy classification', () => {
    it('classifies as image-heavy when images present with very little text', () => {
      expect(classifyContentKind({ charCount: 0, imageCount: 1 })).toBe('image-heavy')
      expect(classifyContentKind({ charCount: 10, imageCount: 1 })).toBe('image-heavy')
      expect(classifyContentKind({ charCount: 49, imageCount: 1 })).toBe('image-heavy')
    })

    it('classifies as image-heavy with multiple images', () => {
      expect(classifyContentKind({ charCount: 0, imageCount: 5 })).toBe('image-heavy')
      expect(classifyContentKind({ charCount: 30, imageCount: 3 })).toBe('image-heavy')
    })
  })

  describe('mixed classification', () => {
    it('classifies as mixed when significant text AND images', () => {
      expect(classifyContentKind({ charCount: 50, imageCount: 1 })).toBe('mixed')
      expect(classifyContentKind({ charCount: 100, imageCount: 2 })).toBe('mixed')
      expect(classifyContentKind({ charCount: 500, imageCount: 5 })).toBe('mixed')
    })

    it('classifies as mixed at boundary (50 chars, 1 image)', () => {
      expect(classifyContentKind({ charCount: 50, imageCount: 1 })).toBe('mixed')
    })
  })

  describe('custom thresholds', () => {
    it('respects custom minCharsForTextRich', () => {
      // With default (20), this would be text-rich
      // With custom (100), this is empty
      expect(
        classifyContentKind({
          charCount: 50,
          imageCount: 0,
          minCharsForTextRich: 100,
        }),
      ).toBe('empty')

      // With custom (10), 15 chars is text-rich
      expect(
        classifyContentKind({
          charCount: 15,
          imageCount: 0,
          minCharsForTextRich: 10,
        }),
      ).toBe('text-rich')
    })

    it('respects custom minImagesForImageContent', () => {
      // With default (1), this would be image-heavy
      // With custom (3), single image doesn't count
      expect(
        classifyContentKind({
          charCount: 10,
          imageCount: 1,
          minImagesForImageContent: 3,
        }),
      ).toBe('empty')

      // With 3 images, now it's image-heavy
      expect(
        classifyContentKind({
          charCount: 10,
          imageCount: 3,
          minImagesForImageContent: 3,
        }),
      ).toBe('image-heavy')
    })

    it('respects custom imageHeavyMaxChars', () => {
      // With default (50), 40 chars + image = image-heavy
      expect(
        classifyContentKind({
          charCount: 40,
          imageCount: 1,
        }),
      ).toBe('image-heavy')

      // With custom (30), 40 chars + image = mixed (since 40 >= 20 and >= 30)
      expect(
        classifyContentKind({
          charCount: 40,
          imageCount: 1,
          imageHeavyMaxChars: 30,
        }),
      ).toBe('mixed')
    })
  })
})

describe('classifyWithCoverage', () => {
  describe('empty classification', () => {
    it('classifies as empty when no text and low coverage', () => {
      expect(classifyWithCoverage({ charCount: 0, maxImageCoverageRatio: 0 })).toBe('empty')
      expect(classifyWithCoverage({ charCount: 0, maxImageCoverageRatio: 0.05 })).toBe('empty')
    })
  })

  describe('text-rich classification', () => {
    it('classifies as text-rich when significant text and low coverage', () => {
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: 0 })).toBe('text-rich')
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: 0.05 })).toBe(
        'text-rich',
      )
    })
  })

  describe('image-heavy classification', () => {
    it('classifies as image-heavy when high coverage and little text', () => {
      expect(classifyWithCoverage({ charCount: 0, maxImageCoverageRatio: 0.6 })).toBe('image-heavy')
      expect(classifyWithCoverage({ charCount: 10, maxImageCoverageRatio: 0.8 })).toBe(
        'image-heavy',
      )
    })
  })

  describe('mixed classification', () => {
    it('classifies as mixed when significant text and moderate coverage', () => {
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: 0.2 })).toBe('mixed')
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: 0.5 })).toBe('mixed')
    })
  })

  describe('unknown classification', () => {
    it('classifies as unknown when some coverage but not enough for image-heavy', () => {
      // Low text (< 20), some coverage (> 0 but < 0.6)
      expect(classifyWithCoverage({ charCount: 5, maxImageCoverageRatio: 0.3 })).toBe('unknown')
    })
  })

  describe('custom thresholds', () => {
    it('respects custom imageHeavyThreshold', () => {
      // With default (0.6), 0.5 coverage isn't image-heavy
      expect(classifyWithCoverage({ charCount: 5, maxImageCoverageRatio: 0.5 })).toBe('unknown')

      // With custom (0.4), 0.5 coverage is image-heavy
      expect(
        classifyWithCoverage({
          charCount: 5,
          maxImageCoverageRatio: 0.5,
          imageHeavyThreshold: 0.4,
        }),
      ).toBe('image-heavy')
    })

    it('respects custom mixedThreshold', () => {
      // With default (0.1), 0.15 coverage with text is mixed
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: 0.15 })).toBe('mixed')

      // With custom (0.2), 0.15 coverage with text is text-rich
      expect(
        classifyWithCoverage({
          charCount: 100,
          maxImageCoverageRatio: 0.15,
          mixedThreshold: 0.2,
        }),
      ).toBe('text-rich')
    })
  })
})

describe('describeContentKind', () => {
  it('describes text-rich', () => {
    expect(describeContentKind('text-rich')).toBe('Primarily text content')
  })

  it('describes image-heavy', () => {
    expect(describeContentKind('image-heavy')).toBe('Primarily images with minimal text')
  })

  it('describes mixed', () => {
    expect(describeContentKind('mixed')).toBe('Both text and images')
  })

  it('describes empty', () => {
    expect(describeContentKind('empty')).toBe('No significant content')
  })

  it('describes unknown', () => {
    expect(describeContentKind('unknown')).toBe('Could not classify')
  })
})

describe('requiresOcr', () => {
  it('returns true for image-heavy', () => {
    expect(requiresOcr('image-heavy')).toBe(true)
  })

  it('returns false for text-rich', () => {
    expect(requiresOcr('text-rich')).toBe(false)
  })

  it('returns false for mixed', () => {
    expect(requiresOcr('mixed')).toBe(false)
  })

  it('returns false for empty', () => {
    expect(requiresOcr('empty')).toBe(false)
  })

  it('returns false for unknown', () => {
    expect(requiresOcr('unknown')).toBe(false)
  })
})

describe('mightBenefitFromOcr', () => {
  it('returns true for image-heavy', () => {
    expect(mightBenefitFromOcr('image-heavy')).toBe(true)
  })

  it('returns true for mixed', () => {
    expect(mightBenefitFromOcr('mixed')).toBe(true)
  })

  it('returns false for text-rich', () => {
    expect(mightBenefitFromOcr('text-rich')).toBe(false)
  })

  it('returns false for empty', () => {
    expect(mightBenefitFromOcr('empty')).toBe(false)
  })

  it('returns false for unknown', () => {
    expect(mightBenefitFromOcr('unknown')).toBe(false)
  })
})

describe('classifyWithCoverage boundary conditions', () => {
  describe('exact threshold boundaries', () => {
    it('classifies exactly at imageHeavyThreshold (0.6) as image-heavy', () => {
      expect(classifyWithCoverage({ charCount: 5, maxImageCoverageRatio: 0.6 })).toBe('image-heavy')
    })

    it('classifies just below imageHeavyThreshold (0.599) as unknown', () => {
      expect(classifyWithCoverage({ charCount: 5, maxImageCoverageRatio: 0.599 })).toBe('unknown')
    })

    it('classifies exactly at mixedThreshold (0.1) with text as mixed', () => {
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: 0.1 })).toBe('mixed')
    })

    it('classifies just below mixedThreshold (0.099) with text as text-rich', () => {
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: 0.099 })).toBe(
        'text-rich',
      )
    })

    it('classifies exactly at minCharsForTextRich (20) with coverage as mixed', () => {
      expect(classifyWithCoverage({ charCount: 20, maxImageCoverageRatio: 0.2 })).toBe('mixed')
    })

    it('classifies just below minCharsForTextRich (19) with high coverage as image-heavy', () => {
      expect(classifyWithCoverage({ charCount: 19, maxImageCoverageRatio: 0.6 })).toBe(
        'image-heavy',
      )
    })
  })

  describe('edge case coverage ratios', () => {
    it('handles coverage ratio > 1.0 (theoretical overflow)', () => {
      // Coverage ratio > 1.0 shouldn't happen in practice but should still work
      expect(classifyWithCoverage({ charCount: 5, maxImageCoverageRatio: 1.5 })).toBe('image-heavy')
    })

    it('handles coverage ratio of exactly 1.0 (full page image)', () => {
      expect(classifyWithCoverage({ charCount: 5, maxImageCoverageRatio: 1.0 })).toBe('image-heavy')
    })

    it('handles negative coverage ratio gracefully', () => {
      // Negative shouldn't happen but should be treated as no coverage
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: -0.1 })).toBe(
        'text-rich',
      )
    })

    it('handles very small positive coverage ratio', () => {
      expect(classifyWithCoverage({ charCount: 100, maxImageCoverageRatio: 0.001 })).toBe(
        'text-rich',
      )
    })

    it('handles zero coverage with zero text as empty', () => {
      expect(classifyWithCoverage({ charCount: 0, maxImageCoverageRatio: 0 })).toBe('empty')
    })
  })
})

describe('classifyContentKind edge cases', () => {
  it('handles very large charCount values', () => {
    expect(classifyContentKind({ charCount: 1_000_000, imageCount: 0 })).toBe('text-rich')
    expect(classifyContentKind({ charCount: 1_000_000, imageCount: 5 })).toBe('mixed')
  })

  it('handles very large imageCount values', () => {
    expect(classifyContentKind({ charCount: 0, imageCount: 1000 })).toBe('image-heavy')
    expect(classifyContentKind({ charCount: 100, imageCount: 1000 })).toBe('mixed')
  })

  it('handles edge case at imageHeavyMaxChars boundary (49 vs 50)', () => {
    // At 49 chars with images = image-heavy (below threshold)
    expect(classifyContentKind({ charCount: 49, imageCount: 1 })).toBe('image-heavy')
    // At 50 chars with images = mixed (at/above threshold for text significance)
    expect(classifyContentKind({ charCount: 50, imageCount: 1 })).toBe('mixed')
  })
})
