import { franc } from 'franc'

import { obs } from '../observability/index.js'
import { SemanticAttributes } from '../observability/types.js'
import { classifyPageKind } from './classify.js'
import { estimateImageCoverageFromPage } from './imageCoverage.js'
import type { PDFPageProxy } from './pdfjs.js'
import { getPageTextContent, getSafePageView } from './pdfjsTypes.js'
import { Metrics, Spans } from './signals.js'
import { textItemsToString } from './text.js'
import type { AnalyzePageOptions, PageAttributes } from './types.js'

/**
 * Default thresholds for page analysis.
 * These values were tuned for accuracy across common document types.
 */
const DEFAULTS: Required<AnalyzePageOptions> = {
  /**
   * Minimum non-whitespace character count for meaningful text.
   * 20 chars filters pages with only page numbers or minimal headers.
   * Must match classify.ts minCharsForTextPage for consistency.
   */
  minCharsForTextPage: 20,

  /**
   * Minimum character count for reliable language detection.
   * franc (ISO 639-3 language detector) needs approximately 80 chars
   * for reliable results. Shorter text may produce incorrect codes.
   */
  minCharsForLangDetect: 80,

  /**
   * Maximum characters to sample for language detection.
   * 400 chars provides sufficient signal for franc while limiting
   * memory usage. Longer samples rarely improve detection accuracy.
   */
  maxTextSampleChars: 400,

  /**
   * Minimum image coverage ratio to count as "content" image.
   * 0.02 (2%) filters out logos, icons, and decorative elements.
   * Must match classify.ts ignoreSmallImagesBelowCoverage.
   */
  minImageCoverageToCount: 0.02,
}

export async function analyzePage(
  page: PDFPageProxy,
  pageIndex: number,
  options: AnalyzePageOptions = {},
): Promise<PageAttributes> {
  const { tracer, metrics } = obs('pdf.analyze')

  return tracer.startSpan(Spans.ANALYZE_PAGE, async (span) => {
    span.setAttribute('pageIndex', pageIndex)

    const cfg = { ...DEFAULTS, ...options }

    // --- geometry ---
    const rotationDeg: number = typeof page.rotate === 'number' ? page.rotate : 0
    const userUnit: number = typeof page.userUnit === 'number' ? page.userUnit : 1
    const view = getSafePageView(page)

    const widthPt = Math.abs((view[2] - view[0]) * userUnit)
    const heightPt = Math.abs((view[3] - view[1]) * userUnit)

    const viewport = page.getViewport({ scale: 1.0 })
    const orientation = viewport.width >= viewport.height ? 'landscape' : 'portrait'

    const paperKey = normalizePaperKey(widthPt, heightPt)

    // --- text signal + raster coverage (parallel for performance) ---
    const [textContent, coverage] = await Promise.all([
      getPageTextContent(page, { normalizeWhitespace: true }),
      estimateImageCoverageFromPage(page, {
        minImageCoverageToCount: cfg.minImageCoverageToCount,
      }),
    ])
    const rawText = textItemsToString(textContent?.items ?? [])
    const charCount = rawText.replace(/\s+/g, '').length
    const textSample = rawText.slice(0, cfg.maxTextSampleChars)

    // --- classify ---
    const kind = classifyPageKind(charCount, coverage, {
      minCharsForTextPage: cfg.minCharsForTextPage,
      ignoreSmallImagesBelowCoverage: cfg.minImageCoverageToCount,
    })

    // --- language ---
    let language = 'und'
    if (charCount >= cfg.minCharsForLangDetect) {
      try {
        language = franc(rawText) || 'und'
      } catch {
        // franc may throw on malformed input; fall back to undetermined
        language = 'und'
      }
    }

    span.setAttribute('kind', kind)
    span.setAttribute('orientation', orientation)
    span.setAttribute(SemanticAttributes.CHAR_COUNT, charCount)
    span.setAttribute(SemanticAttributes.LANGUAGE, language)
    span.setAttribute('imageCount', coverage.images.length)
    metrics.counter(Metrics.PAGE_ANALYZED_COUNT).add(1, { kind })

    return {
      pageIndex,
      kind,
      rotationDeg,
      widthPt,
      heightPt,
      paperKey,
      orientation,
      charCount,
      textSample,
      imageOpCount: coverage.images.length,
      maxImageCoverageRatio: coverage.maxImageCoverageRatio,
      totalImageCoverageRatio: coverage.totalImageCoverageRatio,
      largeImageCount: coverage.largeImageCount,
      language,
    }
  })
}

/**
 * Create a normalized paper size key from page dimensions.
 *
 * Normalizes dimensions by sorting (smaller x larger) so portrait and
 * landscape pages with the same paper size group together.
 *
 * @param widthPt - Page width in points
 * @param heightPt - Page height in points
 * @returns Paper key like "612.0x792.0" (US Letter)
 */
function normalizePaperKey(widthPt: number, heightPt: number): string {
  const a = Math.min(widthPt, heightPt)
  const b = Math.max(widthPt, heightPt)
  // Round to 0.1pt precision (1/10 point) to group pages with minor
  // measurement variations due to scanner calibration or PDF generation
  const r = (n: number) => Math.round(n * 10) / 10
  return `${r(a)}x${r(b)}`
}
