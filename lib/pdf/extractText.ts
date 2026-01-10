import { analyzePage } from './analyzePage.js'
import {
  DEFAULT_MIXED_FALLBACK_CHARS,
  DEFAULT_OCR_RENDER_SCALE,
  DEFAULT_PAGE_SEPARATOR,
  DEFAULT_PAGE_TIMEOUT_MS,
  withTimeout,
} from './constants.js'
import { ocrPdfJsDocument } from './ocr.js'
import { loadPdfDocumentFromBytes } from './pdfjs.js'
import { cleanupPdfDocument, getPageTextContent } from './pdfjsTypes.js'
import { textItemsToString } from './text.js'
import type { ExtractionError, ExtractionResult, ExtractTextOptions } from './types.js'

/**
 * Extract text from a PDF that is assumed to be homogeneous (all pages same type).
 * Automatically selects digital extraction or OCR based on page kind.
 *
 * Returns both the extracted text and any errors that occurred during extraction.
 * Failed pages contribute empty strings to the output.
 */
export async function extractFromHomogeneousPdf(
  pdfBytes: Uint8Array,
  options: ExtractTextOptions = {},
): Promise<ExtractionResult> {
  const {
    kind: forcedKind,
    ocrLang = 'eng',
    ocrRenderScale = DEFAULT_OCR_RENDER_SCALE,
    mixedFallbackToOcrIfUnderChars = DEFAULT_MIXED_FALLBACK_CHARS,
    pageTimeout = DEFAULT_PAGE_TIMEOUT_MS,
  } = options

  const pdf = await loadPdfDocumentFromBytes(pdfBytes)

  try {
    let kind = forcedKind
    if (!kind) {
      const first = await pdf.getPage(1)
      const a0 = await analyzePage(first, 0)
      kind = a0.kind === 'unknown' || a0.kind === 'empty' ? 'born-digital' : a0.kind
    }

    if (kind === 'scanned-image') {
      return await ocrPdfJsDocument(pdf, {
        lang: ocrLang,
        renderScale: ocrRenderScale,
        pageTimeout,
      })
    }

    // born-digital or mixed: extract digitally first
    const byPage: string[] = []
    const errors: ExtractionError[] = []

    for (let i = 0; i < pdf.numPages; i++) {
      try {
        const extractPage = async () => {
          const page = await pdf.getPage(i + 1)
          const tc = await getPageTextContent(page, { normalizeWhitespace: true })
          return textItemsToString(tc?.items ?? [])
        }

        const text = await withTimeout(
          extractPage(),
          pageTimeout,
          `Text extraction page ${i + 1} timed out`,
        )
        byPage.push(text)
      } catch (err) {
        // Graceful degradation: empty string for failed page, track error
        byPage.push('')
        errors.push({
          pageIndex: i,
          phase: 'extract',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    const digitalText = byPage.join(DEFAULT_PAGE_SEPARATOR).trim()

    if (kind === 'born-digital') {
      return {
        text: digitalText,
        pageCount: pdf.numPages,
        errors,
      }
    }

    // mixed: optional OCR fallback if text is basically empty
    const nonWsChars = digitalText.replace(/\s+/g, '').length
    if (nonWsChars >= mixedFallbackToOcrIfUnderChars) {
      return {
        text: digitalText,
        pageCount: pdf.numPages,
        errors,
      }
    }

    // Fall back to OCR, merge errors
    const ocrResult = await ocrPdfJsDocument(pdf, {
      lang: ocrLang,
      renderScale: ocrRenderScale,
      pageTimeout,
    })
    return {
      text: ocrResult.text,
      pageCount: ocrResult.pageCount,
      errors: [...errors, ...ocrResult.errors],
    }
  } finally {
    await cleanupPdfDocument(pdf)
  }
}
