/**
 * Content classification logic for Office documents.
 * Determines ContentKind based on text/image ratios.
 */

import { obs } from '../observability/index.js'
import { SemanticMetrics } from '../observability/types.js'
import type { ContentKind } from './types.js'

/**
 * Default classification thresholds.
 * These mirror the letmesense thresholds where applicable.
 */
export const CLASSIFICATION_DEFAULTS = {
  /** Minimum non-whitespace characters to consider content as having text */
  minCharsForTextRich: 20,

  /** Minimum images to consider content as having significant images */
  minImagesForImageContent: 1,

  /**
   * If imageCount > 0 and charCount < this value, classify as image-heavy.
   * This handles slides/pages that are primarily images with minimal captions.
   */
  imageHeavyMaxChars: 50,

  /**
   * If both text and images are significant, classify as mixed.
   * Text is significant if charCount >= minCharsForTextRich.
   * Images are significant if imageCount >= minImagesForImageContent.
   */
} as const

/** Options for content classification */
export interface ClassifyOptions {
  /** Minimum chars for text-rich classification */
  minCharsForTextRich?: number
  /** Minimum images to be considered image content */
  minImagesForImageContent?: number
  /** Max chars to still be considered image-heavy */
  imageHeavyMaxChars?: number
}

/**
 * Classify content kind based on character count and image count.
 *
 * Classification logic:
 * 1. If no text AND no images → 'empty'
 * 2. If images present AND very little text → 'image-heavy'
 * 3. If significant text AND images → 'mixed'
 * 4. If significant text AND no/few images → 'text-rich'
 * 5. Fallback → 'unknown'
 *
 * @param params - Classification parameters
 * @returns The classified ContentKind
 */
export function classifyContentKind(params: {
  charCount: number
  imageCount: number
  minCharsForTextRich?: number
  minImagesForImageContent?: number
  imageHeavyMaxChars?: number
}): ContentKind {
  const { metrics } = obs('office.classify')

  const {
    charCount,
    imageCount,
    minCharsForTextRich = CLASSIFICATION_DEFAULTS.minCharsForTextRich,
    minImagesForImageContent = CLASSIFICATION_DEFAULTS.minImagesForImageContent,
    imageHeavyMaxChars = CLASSIFICATION_DEFAULTS.imageHeavyMaxChars,
  } = params

  const hasSignificantText = charCount >= minCharsForTextRich
  const hasImages = imageCount >= minImagesForImageContent

  let kind: ContentKind

  // No content at all
  if (charCount === 0 && imageCount === 0) {
    kind = 'empty'
  } else if (hasImages && charCount < imageHeavyMaxChars) {
    // Has images but very little text → image-heavy
    kind = 'image-heavy'
  } else if (hasSignificantText && hasImages) {
    // Has both significant text and images → mixed
    kind = 'mixed'
  } else if (hasSignificantText) {
    // Has significant text but no/few images → text-rich
    kind = 'text-rich'
  } else if (charCount > 0 && !hasImages) {
    // Has some text but not enough to be "significant" and no images
    // Small amount of text, no images - could be page numbers, headers, etc.
    kind = 'empty' // Treat as effectively empty
  } else {
    // Shouldn't reach here, but fallback
    kind = 'unknown'
  }

  metrics.counter(SemanticMetrics.OFFICE_CLASSIFICATION_COUNT).add(1, { kind })

  return kind
}

/**
 * Classify with image coverage ratio (for compatibility with letmesense style).
 * This is an alternative classification that uses area-based metrics.
 *
 * @param params - Classification parameters with coverage ratios
 * @returns The classified ContentKind
 */
export function classifyWithCoverage(params: {
  charCount: number
  maxImageCoverageRatio?: number
  minCharsForTextRich?: number
  imageHeavyThreshold?: number
  mixedThreshold?: number
}): ContentKind {
  const { metrics } = obs('office.classify')

  const {
    charCount,
    maxImageCoverageRatio = 0,
    minCharsForTextRich = CLASSIFICATION_DEFAULTS.minCharsForTextRich,
    imageHeavyThreshold = 0.6,
    mixedThreshold = 0.1,
  } = params

  const hasSignificantText = charCount >= minCharsForTextRich

  let kind: ContentKind

  // No text and no significant image coverage
  if (charCount === 0 && maxImageCoverageRatio < mixedThreshold) {
    kind = 'empty'
  } else if (!hasSignificantText && maxImageCoverageRatio >= imageHeavyThreshold) {
    // High image coverage with little text → image-heavy (like scanned)
    kind = 'image-heavy'
  } else if (hasSignificantText) {
    // Has text - check for mixed content
    if (maxImageCoverageRatio >= mixedThreshold) {
      kind = 'mixed'
    } else {
      kind = 'text-rich'
    }
  } else if (maxImageCoverageRatio > 0) {
    // Some image coverage but not enough to be image-heavy
    kind = 'unknown'
  } else {
    kind = 'empty'
  }

  metrics.counter(SemanticMetrics.OFFICE_CLASSIFICATION_COVERAGE_COUNT).add(1, { kind })

  return kind
}

/**
 * Get a human-readable description of a ContentKind.
 */
export function describeContentKind(kind: ContentKind): string {
  switch (kind) {
    case 'text-rich':
      return 'Primarily text content'
    case 'image-heavy':
      return 'Primarily images with minimal text'
    case 'mixed':
      return 'Both text and images'
    case 'table':
      return 'Contains tables or charts'
    case 'empty':
      return 'No significant content'
    case 'unknown':
      return 'Could not classify'
  }
}

/**
 * Check if a ContentKind requires OCR for text extraction.
 */
export function requiresOcr(kind: ContentKind): boolean {
  return kind === 'image-heavy'
}

/**
 * Check if a ContentKind might benefit from OCR.
 */
export function mightBenefitFromOcr(kind: ContentKind): boolean {
  return kind === 'image-heavy' || kind === 'mixed'
}
