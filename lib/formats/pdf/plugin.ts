/**
 * PDF plugin for the unified extraction pipeline.
 * Adapts existing lib/pdf/ code to the FormatPlugin interface.
 */

import fs from 'node:fs/promises'

import { toTesseractLang } from '../../common/languages.js'
import { obs, SemanticAttributes } from '../../observability/index.js'
import { analyzePage } from '../../pdf/analyzePage.js'
import { classifyPageKind } from '../../pdf/classify.js'
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_MIXED_FALLBACK_CHARS,
  DEFAULT_OCR_RENDER_SCALE,
  DEFAULT_PAGE_TIMEOUT_MS,
  withTimeout,
} from '../../pdf/constants.js'
import { loadPdfDocumentFromBytes } from '../../pdf/pdfjs.js'
import { cleanupPdfDocument, getPageTextContent } from '../../pdf/pdfjsTypes.js'
import { renderPageWithPlaywright } from '../../pdf/playwrightRender.js'
import { renderPage } from '../../pdf/render.js'
import { textItemsToString } from '../../pdf/text.js'
import type { CliOption, FormatPlugin, RenderedContent } from '../../pipeline/plugin.js'
import type { ContentKind, UnitExtractionResult } from '../../pipeline/types.js'
import { ocrSinglePage } from './ocr.js'
import { Metrics, Spans } from './signals.js'
import {
  mapContentKindToPageKind,
  mapPageKindToContentKind,
  type PdfExtractOptions,
  type PdfLoadedDocument,
  type PdfUnit,
} from './types.js'

// ============================================================================
// CJK Detection
// ============================================================================

/**
 * Check if text contains CJK characters (Chinese, Japanese, Korean).
 * Used to auto-detect when Playwright rendering is needed for proper font support.
 */
function hasCJK(text: string): boolean {
  // Remove control chars (U+0000-U+001F, U+007F-U+009F) and whitespace
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\s\u3000\u00A0\uFEFF]/g, '')

  // CJK Unified Ideographs, Hiragana, Katakana, Hangul
  return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(cleaned)
}

// ============================================================================
// PDF Plugin Implementation
// ============================================================================

export const pdfPlugin: FormatPlugin<PdfUnit, PdfExtractOptions> = {
  // -------------------- Identity --------------------

  id: 'pdf',
  name: 'PDF',
  extensions: ['.pdf', '.PDF'],
  mimeTypes: ['application/pdf'],

  capabilities: {
    ocr: true,
    vision: true,
    streaming: true,
    parallel: true,
    supportsRuns: true,
    multiUnit: true,
  },

  // -------------------- Lifecycle --------------------

  async load(input, options = {}): Promise<PdfLoadedDocument> {
    const { tracer, metrics, logger } = obs('pdf.plugin')
    const { fetchTimeout = DEFAULT_FETCH_TIMEOUT_MS, fetchHeaders } = options

    return tracer.startSpan(Spans.LOAD, async (span) => {
      const inputType =
        input instanceof Uint8Array
          ? 'buffer'
          : Buffer.isBuffer(input)
            ? 'buffer'
            : input instanceof URL
              ? 'url'
              : typeof input === 'string' && input.startsWith('http')
                ? 'url'
                : 'file'
      span.setAttribute(SemanticAttributes.INPUT_TYPE, inputType)

      let bytes: Uint8Array

      if (input instanceof Uint8Array) {
        bytes = input
      } else if (Buffer.isBuffer(input)) {
        bytes = new Uint8Array(input)
      } else if (input instanceof URL) {
        bytes = await fetchPdfFromUrl(input.toString(), fetchTimeout, fetchHeaders)
      } else if (typeof input === 'string') {
        if (input.startsWith('http://') || input.startsWith('https://')) {
          bytes = await fetchPdfFromUrl(input, fetchTimeout, fetchHeaders)
        } else {
          // File path
          const buffer = await fs.readFile(input)
          // Create a copy to ensure proper Uint8Array (Buffer's underlying ArrayBuffer might be larger)
          bytes = Uint8Array.from(buffer)
        }
      } else {
        throw new Error('Invalid input type: expected string, Uint8Array, Buffer, or URL')
      }

      span.setAttribute(SemanticAttributes.BYTES, bytes.length)
      metrics.histogram(Metrics.LOAD_BYTES).record(bytes.length)

      // Make a copy of bytes before passing to pdf.js, as it may transfer the ArrayBuffer
      const storedBytes = new Uint8Array(bytes)
      const pdf = await loadPdfDocumentFromBytes(bytes)

      span.setAttribute(SemanticAttributes.PAGE_COUNT, pdf.numPages)
      metrics.counter(Metrics.LOAD_COUNT).add(1)
      logger.debug({ bytes: bytes.length, pageCount: pdf.numPages }, 'PDF loaded')

      return {
        bytes: storedBytes,
        format: 'pdf',
        pdf,
      }
    })
  },

  async parse(doc): Promise<{ units: PdfUnit[]; metadata?: Record<string, unknown> }> {
    const { tracer, metrics } = obs('pdf.plugin')
    const { pdf } = doc as PdfLoadedDocument

    return tracer.startSpan(Spans.PARSE, async (span) => {
      span.setAttribute(SemanticAttributes.PAGE_COUNT, pdf.numPages)
      const units: PdfUnit[] = []

      for (let i = 0; i < pdf.numPages; i++) {
        const pageNumber = i + 1
        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1.0 })

        units.push({
          index: i,
          label: `Page ${pageNumber}`,
          kind: 'unknown',
          charCount: 0,
          language: 'und',
          textSample: '',
          rotationDeg: typeof page.rotate === 'number' ? page.rotate : 0,
          widthPt: viewport.width,
          heightPt: viewport.height,
          paperKey: '',
          orientation: viewport.width >= viewport.height ? 'landscape' : 'portrait',
          imageOpCount: 0,
          maxImageCoverageRatio: 0,
          totalImageCoverageRatio: 0,
          largeImageCount: 0,
          pageKind: 'unknown',
          pageNumber,
        })
      }

      // Extract metadata if available
      let metadata: Record<string, unknown> | undefined
      try {
        const info = await pdf.getMetadata()
        if (info?.info) {
          const pdfInfo = info.info as Record<string, unknown>
          metadata = {
            title: pdfInfo.Title,
            author: pdfInfo.Author,
            subject: pdfInfo.Subject,
            keywords: pdfInfo.Keywords,
            creator: pdfInfo.Creator,
            producer: pdfInfo.Producer,
            creationDate: pdfInfo.CreationDate,
            modificationDate: pdfInfo.ModDate,
          }
        }
      } catch {
        // Metadata extraction is optional
      }

      span.setAttribute(SemanticAttributes.UNIT_COUNT, units.length)
      metrics.counter(Metrics.UNIT_COUNT).add(units.length)

      return { units, metadata }
    })
  },

  async analyzeUnit(unit, doc): Promise<PdfUnit> {
    const { tracer, metrics } = obs('pdf.plugin')
    const { pdf } = doc as PdfLoadedDocument

    return tracer.startSpan(Spans.ANALYZE_UNIT, async (span) => {
      span.setAttribute('pageNumber', unit.pageNumber)
      const page = await pdf.getPage(unit.pageNumber)

      // Use existing analyzePage function
      const attrs = await analyzePage(page, unit.index)

      span.setAttribute(SemanticAttributes.CHAR_COUNT, attrs.charCount)
      span.setAttribute(SemanticAttributes.LANGUAGE, attrs.language)
      span.setAttribute('pageKind', attrs.kind)
      metrics.counter(Metrics.ANALYZE_PAGE_COUNT).add(1, { kind: attrs.kind })

      // Update unit with analysis results
      return {
        ...unit,
        charCount: attrs.charCount,
        language: attrs.language,
        textSample: attrs.textSample,
        rotationDeg: attrs.rotationDeg,
        widthPt: attrs.widthPt,
        heightPt: attrs.heightPt,
        paperKey: attrs.paperKey,
        orientation: attrs.orientation,
        imageOpCount: attrs.imageOpCount,
        maxImageCoverageRatio: attrs.maxImageCoverageRatio ?? 0,
        totalImageCoverageRatio: attrs.totalImageCoverageRatio ?? 0,
        largeImageCount: attrs.largeImageCount ?? 0,
        pageKind: attrs.kind,
        kind: mapPageKindToContentKind(attrs.kind),
      }
    })
  },

  classifyUnit(unit): ContentKind {
    // Re-classify using the classify function for consistency
    const pageKind = classifyPageKind(
      unit.charCount,
      {
        maxImageCoverageRatio: unit.maxImageCoverageRatio,
        totalImageCoverageRatio: unit.totalImageCoverageRatio,
        largeImageCount: unit.largeImageCount,
      },
      {},
    )
    return mapPageKindToContentKind(pageKind)
  },

  buildRunKey(unit): string {
    // PDF uses 4 dimensions: kind|paperKey|orientation|language
    return `${unit.kind}|${unit.paperKey}|${unit.orientation}|${unit.language}`
  },

  async extractUnit(unit, doc, options = {}): Promise<UnitExtractionResult> {
    const { tracer, metrics, logger } = obs('pdf.plugin')
    const { pdf } = doc as PdfLoadedDocument
    const {
      ocrLanguage: ocrLang = 'eng',
      ocrRenderScale = DEFAULT_OCR_RENDER_SCALE,
      mixedFallbackToOcrIfUnderChars = DEFAULT_MIXED_FALLBACK_CHARS,
      pageTimeout = DEFAULT_PAGE_TIMEOUT_MS,
    } = options

    return tracer.startSpan(Spans.EXTRACT_UNIT, async (span) => {
      span.setAttribute('pageNumber', unit.pageNumber)
      span.setAttribute('kind', unit.kind)

      const page = await pdf.getPage(unit.pageNumber)
      const pageKind = mapContentKindToPageKind(unit.kind)

      // Scanned pages need OCR
      if (pageKind === 'scanned-image') {
        span.setAttribute(SemanticAttributes.METHOD, 'ocr')
        const runOcrLang =
          unit.language !== 'und' ? toTesseractLang(unit.language, ocrLang) : ocrLang
        const result = await ocrSinglePage(page, {
          lang: runOcrLang,
          renderScale: ocrRenderScale,
          pageTimeout,
        })

        const charCount = result.text.replace(/\s+/g, '').length
        span.setAttribute(SemanticAttributes.CHAR_COUNT, charCount)
        span.setAttribute(SemanticAttributes.CONFIDENCE, result.confidence)
        metrics.counter(Metrics.EXTRACT_PAGE_COUNT).add(1, { method: 'ocr' })
        metrics.histogram(Metrics.EXTRACT_CHARS).record(charCount)

        return {
          text: result.text,
          charCount,
          extraction: {
            method: 'ocr',
            reliability:
              result.confidence >= 0.95 ? 'high' : result.confidence >= 0.8 ? 'medium' : 'low',
            confidence: result.confidence,
            ocrEngine: 'tesseract',
          },
        }
      }

      // Digital extraction for born-digital and mixed
      span.setAttribute(SemanticAttributes.METHOD, 'digital')
      const extractDigital = async () => {
        const tc = await getPageTextContent(page, { normalizeWhitespace: true })
        return textItemsToString(tc?.items ?? [])
      }

      const text = await withTimeout(
        extractDigital(),
        pageTimeout,
        `Text extraction page ${unit.pageNumber} timed out`,
      )

      // For mixed pages, check if we need OCR fallback
      if (pageKind === 'mixed') {
        const nonWsChars = text.replace(/\s+/g, '').length
        if (nonWsChars < mixedFallbackToOcrIfUnderChars) {
          // Fall back to OCR
          span.setAttribute(SemanticAttributes.METHOD, 'hybrid')
          logger.debug(
            { pageNumber: unit.pageNumber, nonWsChars },
            'Mixed page falling back to OCR',
          )

          const runOcrLang =
            unit.language !== 'und' ? toTesseractLang(unit.language, ocrLang) : ocrLang
          const result = await ocrSinglePage(page, {
            lang: runOcrLang,
            renderScale: ocrRenderScale,
            pageTimeout,
          })

          const charCount = result.text.replace(/\s+/g, '').length
          span.setAttribute(SemanticAttributes.CHAR_COUNT, charCount)
          span.setAttribute(SemanticAttributes.CONFIDENCE, result.confidence)
          metrics.counter(Metrics.EXTRACT_PAGE_COUNT).add(1, { method: 'hybrid' })
          metrics.histogram(Metrics.EXTRACT_CHARS).record(charCount)

          return {
            text: result.text,
            charCount,
            extraction: {
              method: 'hybrid',
              reliability:
                result.confidence >= 0.95 ? 'high' : result.confidence >= 0.8 ? 'medium' : 'low',
              confidence: result.confidence,
              ocrEngine: 'tesseract',
            },
          }
        }
      }

      const charCount = text.replace(/\s+/g, '').length
      span.setAttribute(SemanticAttributes.CHAR_COUNT, charCount)
      metrics.counter(Metrics.EXTRACT_PAGE_COUNT).add(1, { method: 'digital' })
      metrics.histogram(Metrics.EXTRACT_CHARS).record(charCount)

      return {
        text,
        charCount,
        extraction: {
          method: 'digital',
          reliability: 'exact',
        },
      }
    })
  },

  async renderUnit(unit, doc, options = {}): Promise<RenderedContent> {
    const { tracer, metrics, logger } = obs('pdf.plugin')
    const loadedDoc = doc as PdfLoadedDocument
    const { pdf, bytes } = loadedDoc
    const {
      scale = DEFAULT_OCR_RENDER_SCALE,
      usePlaywright = 'auto',
      textForCjkDetection,
    } = options

    return tracer.startSpan(Spans.RENDER_UNIT, async (span) => {
      span.setAttribute('pageNumber', unit.pageNumber)
      span.setAttribute(SemanticAttributes.SCALE, scale)
      span.setAttribute('playwrightMode', usePlaywright)

      // Determine if Playwright should be used
      // Use textForCjkDetection (from extractUnit) or fall back to unit.textSample
      const textToCheck = textForCjkDetection || unit.textSample || ''
      const cjkDetected = hasCJK(textToCheck)
      const shouldUsePlaywright =
        usePlaywright === 'always' || (usePlaywright === 'auto' && cjkDetected)

      span.setAttribute('usePlaywright', shouldUsePlaywright)
      span.setAttribute('cjkDetected', cjkDetected)

      // Use Playwright rendering for better CJK font support
      if (shouldUsePlaywright) {
        logger.debug(
          { pageNumber: unit.pageNumber, cjkDetected, mode: usePlaywright },
          'Using Playwright renderer',
        )
        const rendered = await renderPageWithPlaywright(bytes, unit.pageNumber, {
          scale,
          timeout: 30000,
        })

        span.setAttribute(SemanticAttributes.WIDTH, rendered.width)
        span.setAttribute(SemanticAttributes.HEIGHT, rendered.height)
        span.setAttribute(SemanticAttributes.BYTES, rendered.buffer.length)
        span.setAttribute('renderer', 'playwright')
        metrics.counter(Metrics.RENDER_PAGE_COUNT).add(1, { renderer: 'playwright' })
        metrics.histogram(Metrics.RENDER_BYTES).record(rendered.buffer.length)

        return {
          base64: rendered.buffer.toString('base64'),
          mimeType: 'image/png',
          width: rendered.width,
          height: rendered.height,
        }
      }

      // Default: use Node.js pdf.js + @napi-rs/canvas
      const page = await pdf.getPage(unit.pageNumber)
      const rendered = await renderPage(page, { scale, format: 'png' })

      span.setAttribute(SemanticAttributes.WIDTH, rendered.width)
      span.setAttribute(SemanticAttributes.HEIGHT, rendered.height)
      span.setAttribute(SemanticAttributes.BYTES, rendered.buffer.length)
      span.setAttribute('renderer', 'canvas')
      metrics.counter(Metrics.RENDER_PAGE_COUNT).add(1, { renderer: 'canvas' })
      metrics.histogram(Metrics.RENDER_BYTES).record(rendered.buffer.length)

      return {
        base64: rendered.buffer.toString('base64'),
        mimeType: 'image/png',
        width: rendered.width,
        height: rendered.height,
      }
    })
  },

  async cleanup(doc): Promise<void> {
    const { pdf } = doc as PdfLoadedDocument
    await cleanupPdfDocument(pdf)
  },

  getCliOptions(): CliOption[] {
    return [
      {
        flags: '--ocr-lang <lang>',
        description: 'OCR language(s): "eng" or "eng+jpn"',
        defaultValue: 'eng',
      },
      {
        flags: '--page-timeout <ms>',
        description: 'Per-page timeout in milliseconds',
        defaultValue: 60000,
      },
      {
        flags: '--playwright <mode>',
        description: 'Playwright rendering: always, auto (default), none',
        defaultValue: 'auto',
      },
    ]
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

async function fetchPdfFromUrl(
  url: string,
  timeout: number,
  headers?: Record<string, string>,
): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'letmesense/1.0',
        ...headers,
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type')
    if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream')) {
      throw new Error(`Unexpected content-type: ${contentType}`)
    }

    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
  } finally {
    clearTimeout(timeoutId)
  }
}
