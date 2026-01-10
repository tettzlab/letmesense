import { obs } from '../observability/index.js'
import { SemanticMetrics } from '../observability/types.js'
import type { PageKind } from './types.js'

export interface ClassifyOptions {
  minCharsForTextPage?: number // default 20

  // A page with a very large raster image and little/no text is likely a scan.
  scannedIfMaxImageCoverageAtLeast?: number // default 0.6

  // If text exists and a meaningful raster covers a chunk of the page, treat as mixed.
  mixedIfMaxImageCoverageAtLeast?: number // default 0.1

  // Images smaller than this are treated as decorative (logos/icons).
  ignoreSmallImagesBelowCoverage?: number // default 0.02
}

/**
 * Default thresholds for page classification.
 * These values were tuned empirically on a corpus of mixed PDFs.
 *
 * Override minCharsForTextPage via LETMESENSE_TEXT_THRESHOLD environment variable.
 */
const DEFAULTS: Required<ClassifyOptions> = {
  /**
   * Minimum non-whitespace character count to consider a page as having
   * meaningful text. 20 chars filters pages with only page numbers,
   * minimal headers, or single-word footers.
   */
  minCharsForTextPage: process.env.LETMESENSE_TEXT_THRESHOLD
    ? parseInt(process.env.LETMESENSE_TEXT_THRESHOLD, 10)
    : 20,

  /**
   * Image coverage threshold to classify as scanned-image (when no text).
   * 0.6 (60%) indicates a single image covering most of the page,
   * typical of full-page scans. Lower values may false-positive on
   * pages with large photos alongside text.
   */
  scannedIfMaxImageCoverageAtLeast: 0.6,

  /**
   * Image coverage threshold to classify as mixed (when text exists).
   * 0.1 (10%) captures pages with embedded photos, diagrams, or
   * partial scans mixed with digital text. Lower values may flag
   * pages with small decorative images as mixed.
   */
  mixedIfMaxImageCoverageAtLeast: 0.1,

  /**
   * Minimum coverage ratio to count an image as "content" vs decorative.
   * 0.02 (2%) filters out small logos, icons, separator lines, and
   * decorative elements that shouldn't affect page classification.
   */
  ignoreSmallImagesBelowCoverage: 0.02,
}

export function classifyPageKind(
  charCount: number,
  cov: { maxImageCoverageRatio: number; totalImageCoverageRatio: number; largeImageCount: number },
  options: ClassifyOptions = {},
): PageKind {
  const { metrics } = obs('pdf.classify')

  const cfg = { ...DEFAULTS, ...options }
  const hasText = charCount >= cfg.minCharsForTextPage

  let kind: PageKind

  if (!hasText && cov.largeImageCount === 0) {
    kind = 'empty'
  } else if (!hasText && cov.maxImageCoverageRatio >= cfg.scannedIfMaxImageCoverageAtLeast) {
    // Big raster dominates + little/no text => scanned
    kind = 'scanned-image'
  } else if (hasText && cov.maxImageCoverageRatio >= cfg.mixedIfMaxImageCoverageAtLeast) {
    // Text present + meaningful raster => mixed
    kind = 'mixed'
  } else if (hasText && cov.maxImageCoverageRatio < cfg.ignoreSmallImagesBelowCoverage) {
    // Text present + only tiny rasters => born-digital
    kind = 'born-digital'
  } else if (hasText) {
    // Fallback with text
    kind = 'born-digital'
  } else if (cov.largeImageCount > 0) {
    // Fallback with images
    kind = 'scanned-image'
  } else {
    kind = 'unknown'
  }

  metrics.counter(SemanticMetrics.PDF_CLASSIFICATION_COUNT).add(1, { kind })

  return kind
}
