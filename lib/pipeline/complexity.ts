/**
 * Document Complexity Metrics
 *
 * Track document characteristics for capacity planning and performance analysis.
 * Complexity scores help identify documents that may cause slow processing.
 */

import type { DocumentUnit, FormatId } from './types.js'

/**
 * Document complexity metrics
 */
export interface DocumentComplexity {
  /** Total number of pages/units */
  pageCount: number
  /** Total non-whitespace character count */
  charCount: number
  /** Number of image-only or mixed content units */
  imageCount: number
  /** Whether any unit requires OCR (scanned-image kind) */
  hasOcr: boolean
  /** Whether document has both text and image units */
  hasMixedContent: boolean
  /** Whether document has tabular data */
  hasTabular: boolean
  /** Normalized complexity score (0-100) */
  score: number
}

/**
 * Weights for complexity score calculation
 */
const COMPLEXITY_WEIGHTS = {
  /** Points per page/unit */
  pageWeight: 2,
  /** Points per 1000 characters */
  charWeight: 1,
  /** Points per image unit */
  imageWeight: 5,
  /** Bonus for OCR-required content */
  ocrBonus: 20,
  /** Bonus for mixed content */
  mixedBonus: 10,
  /** Bonus for tabular data */
  tabularBonus: 5,
  /** Maximum score cap */
  maxScore: 100,
}

/**
 * Compute complexity metrics for a set of document units
 *
 * @example
 * ```typescript
 * const complexity = computeComplexity(units)
 * span.setAttribute('document.complexity.score', complexity.score)
 * span.setAttribute('document.page.count', complexity.pageCount)
 * metrics.histogram('document.complexity.score').record(complexity.score, { format })
 * ```
 */
export function computeComplexity(units: DocumentUnit[]): DocumentComplexity {
  const pageCount = units.length
  const charCount = units.reduce((sum, u) => sum + u.charCount, 0)

  // Count image-containing units (image-only or mixed content)
  const imageCount = units.filter((u) => u.kind === 'image-only' || u.kind === 'mixed').length

  // Check for OCR content (image-only units with low char count likely need OCR)
  // Also unknown units with low char count may be scanned content
  const hasOcr = units.some(
    (u) =>
      u.kind === 'image-only' ||
      (u.kind === 'unknown' && u.charCount < 50) ||
      (u.kind === 'mixed' && u.charCount < 100),
  )

  // Check for mixed content types (document has both text-only and image-containing units)
  const hasTextUnits = units.some((u) => u.kind === 'text-only')
  const hasImageUnits = units.some((u) => u.kind === 'image-only' || u.kind === 'mixed')
  const hasMixedContent = hasTextUnits && hasImageUnits

  // Check for tabular data
  const hasTabular = units.some((u) => u.kind === 'tabular')

  // Calculate weighted score
  const rawScore =
    pageCount * COMPLEXITY_WEIGHTS.pageWeight +
    (charCount / 1000) * COMPLEXITY_WEIGHTS.charWeight +
    imageCount * COMPLEXITY_WEIGHTS.imageWeight +
    (hasOcr ? COMPLEXITY_WEIGHTS.ocrBonus : 0) +
    (hasMixedContent ? COMPLEXITY_WEIGHTS.mixedBonus : 0) +
    (hasTabular ? COMPLEXITY_WEIGHTS.tabularBonus : 0)

  // Normalize to 0-100
  const score = Math.min(COMPLEXITY_WEIGHTS.maxScore, Math.round(rawScore))

  return {
    pageCount,
    charCount,
    imageCount,
    hasOcr,
    hasMixedContent,
    hasTabular,
    score,
  }
}

/**
 * Get span attributes for document complexity
 */
export function getComplexitySpanAttributes(
  complexity: DocumentComplexity,
  format?: FormatId | string,
): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    'document.page.count': complexity.pageCount,
    'document.char.count': complexity.charCount,
    'document.image.count': complexity.imageCount,
    'document.has_ocr': complexity.hasOcr,
    'document.has_mixed_content': complexity.hasMixedContent,
    'document.has_tabular': complexity.hasTabular,
    'document.complexity.score': complexity.score,
  }

  if (format) {
    attrs['document.format'] = format
  }

  return attrs
}

/**
 * Classify complexity level from score
 */
export function getComplexityLevel(score: number): 'low' | 'medium' | 'high' | 'very_high' {
  if (score < 20) return 'low'
  if (score < 50) return 'medium'
  if (score < 80) return 'high'
  return 'very_high'
}
