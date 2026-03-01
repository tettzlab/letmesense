/**
 * HTML/web plugin for the unified extraction pipeline.
 * Converts HTML → clean markdown via Readability + Turndown.
 * Supports: .html, .htm, .xhtml
 */

import fs from 'node:fs/promises'

import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

import { DEFAULT_FETCH_TIMEOUT_MS } from '../../common/timeouts.js'
import { obs, SemanticAttributes } from '../../observability/index.js'
import type { CliOption, FormatPlugin } from '../../pipeline/plugin.js'
import type { ContentKind, UnitExtractionResult } from '../../pipeline/types.js'
import { Metrics, Spans } from './signals.js'
import {
  classifyHtml,
  type WebExtractOptions,
  type WebLoadedDocument,
  type WebUnit,
} from './types.js'

// ============================================================================
// HTML Plugin Implementation
// ============================================================================

export const webPlugin: FormatPlugin<WebUnit, WebExtractOptions> = {
  // -------------------- Identity --------------------

  id: 'html',
  name: 'HTML',
  extensions: ['.html', '.HTML', '.htm', '.HTM', '.xhtml', '.XHTML'],
  mimeTypes: ['text/html', 'application/xhtml+xml'],

  capabilities: {
    ocr: false,
    vision: false,
    streaming: false,
    parallel: false,
    supportsRuns: false,
    multiUnit: false,
  },

  // -------------------- Lifecycle --------------------

  async load(input, options = {}): Promise<WebLoadedDocument> {
    const { tracer, metrics, logger } = obs('web.plugin')
    const { fetchTimeout = DEFAULT_FETCH_TIMEOUT_MS, sourceUrl } = options

    return tracer.startSpan(Spans.LOAD, async (span) => {
      let bytes: Uint8Array
      let source: string

      if (input instanceof Uint8Array) {
        bytes = input
        source = sourceUrl ?? 'buffer'
        span.setAttribute(SemanticAttributes.INPUT_TYPE, sourceUrl ? 'url' : 'buffer')
      } else if (input instanceof URL) {
        span.setAttribute(SemanticAttributes.INPUT_TYPE, 'url')
        const result = await fetchHtml(input.toString(), fetchTimeout)
        bytes = result.bytes
        source = input.toString()
      } else if (typeof input === 'string') {
        if (input.startsWith('http://') || input.startsWith('https://')) {
          span.setAttribute(SemanticAttributes.INPUT_TYPE, 'url')
          const result = await fetchHtml(input, fetchTimeout)
          bytes = result.bytes
          source = input
        } else {
          span.setAttribute(SemanticAttributes.INPUT_TYPE, 'file')
          const buffer = await fs.readFile(input)
          bytes = new Uint8Array(buffer)
          source = input
        }
      } else {
        throw new Error('Invalid input type: expected string, Uint8Array, Buffer, or URL')
      }

      span.setAttribute(SemanticAttributes.BYTES, bytes.length)

      const html = new TextDecoder().decode(bytes)

      metrics.counter(Metrics.LOAD_COUNT).add(1)
      metrics.histogram(Metrics.LOAD_BYTES).record(bytes.length)
      logger.debug({ bytes: bytes.length, source }, 'HTML loaded')

      return {
        bytes,
        format: 'html',
        html,
        source,
      }
    })
  },

  async parse(doc): Promise<{ units: WebUnit[]; metadata?: Record<string, unknown> }> {
    const { tracer, metrics } = obs('web.plugin')
    const loadedDoc = doc as WebLoadedDocument
    const { html, source } = loadedDoc

    return tracer.startSpan(Spans.PARSE, async (span) => {
      const dom = new JSDOM(html, { url: source.startsWith('http') ? source : undefined })
      const reader = new Readability(dom.window.document.cloneNode(true) as Document)
      const article = reader.parse()

      const title =
        article?.title || dom.window.document.querySelector('title')?.textContent || undefined
      const readabilitySuccess = article !== null && (article.textContent?.trim().length ?? 0) > 0

      if (readabilitySuccess) {
        metrics.counter(Metrics.READABILITY_SUCCESS_COUNT).add(1)
      } else {
        metrics.counter(Metrics.READABILITY_FAIL_COUNT).add(1)
      }

      // Cache DOM results for reuse in analyzeUnit/extractUnit
      const textContent = dom.window.document.body?.textContent ?? ''
      const langAttr =
        dom.window.document.documentElement.getAttribute('lang')?.split('-')[0] ?? 'und'
      const imageCount = dom.window.document.querySelectorAll('img').length
      const tableCount = dom.window.document.querySelectorAll('table').length

      loadedDoc.cached = {
        article: article
          ? {
              title: article.title,
              content: article.content,
              textContent: article.textContent,
              byline: article.byline,
              publishedTime: article.publishedTime,
              siteName: article.siteName,
              excerpt: article.excerpt,
            }
          : null,
        textContent,
        langAttr,
      }

      const charCount = textContent.replace(/\s+/g, '').length

      const unit: WebUnit = {
        index: 0,
        label: title ?? 'Document',
        kind: classifyHtml({ charCount, imageCount, tableCount }),
        charCount,
        language: langAttr,
        textSample: textContent.trim().slice(0, 400),
        title,
        url: source.startsWith('http') ? source : undefined,
        author: article?.byline ?? undefined,
        publishedDate: article?.publishedTime ?? undefined,
        siteName: article?.siteName ?? undefined,
        excerpt: article?.excerpt ?? undefined,
        htmlByteSize: loadedDoc.bytes.length,
        readabilitySuccess,
      }

      span.setAttribute(SemanticAttributes.UNIT_COUNT, 1)
      metrics.counter(Metrics.UNIT_COUNT).add(1)

      return {
        units: [unit],
        metadata: {
          source,
          title,
          author: article?.byline,
          siteName: article?.siteName,
          excerpt: article?.excerpt,
        },
      }
    })
  },

  async analyzeUnit(unit, doc): Promise<WebUnit> {
    const { tracer, metrics } = obs('web.plugin')
    const loadedDoc = doc as WebLoadedDocument

    return tracer.startSpan(Spans.ANALYZE_UNIT, async (span) => {
      // Reuse cached DOM results from parse()
      const { textContent, langAttr } = loadedDoc.cached ?? parseDom(loadedDoc.html)
      const charCount = textContent.replace(/\s+/g, '').length
      const textSample = textContent.trim().slice(0, 400)

      span.setAttribute(SemanticAttributes.CHAR_COUNT, charCount)
      metrics.counter(Metrics.ANALYZE_UNIT_COUNT).add(1)

      return {
        ...unit,
        charCount,
        textSample,
        language: langAttr,
      }
    })
  },

  classifyUnit(unit): ContentKind {
    // Unit already classified during parse(); return stored kind
    return unit.kind !== 'unknown'
      ? unit.kind
      : classifyHtml({ charCount: unit.charCount, imageCount: 0, tableCount: 0 })
  },

  async extractUnit(unit, doc, options = {}): Promise<UnitExtractionResult> {
    const { tracer, metrics } = obs('web.plugin')
    const loadedDoc = doc as WebLoadedDocument
    const { html, source } = loadedDoc
    const { includeLinks = true, includeImages = true } = options

    return tracer.startSpan(Spans.EXTRACT_UNIT, async (span) => {
      // Reuse cached Readability result from parse()
      let contentHtml: string
      if (loadedDoc.cached?.article?.content) {
        contentHtml = loadedDoc.cached.article.content
      } else {
        const dom = new JSDOM(html, { url: source.startsWith('http') ? source : undefined })
        const reader = new Readability(dom.window.document.cloneNode(true) as Document)
        const article = reader.parse()
        contentHtml = article?.content ?? dom.window.document.body?.innerHTML ?? ''
      }

      const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      })

      // Custom rule to strip links if requested
      if (!includeLinks) {
        turndown.addRule('stripLinks', {
          filter: 'a',
          replacement: (_content, node) => (node as HTMLElement).textContent ?? '',
        })
      }

      // Custom rule to strip images if requested
      if (!includeImages) {
        turndown.addRule('stripImages', {
          filter: 'img',
          replacement: () => '',
        })
      }

      let markdown = turndown.turndown(contentHtml)

      // Prepend title as heading if not already present
      const title = unit.title
      if (title && !markdown.startsWith(`# ${title}`)) {
        markdown = `# ${title}\n\n${markdown}`
      }

      // Clean up excessive whitespace
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()

      const charCount = markdown.replace(/\s+/g, '').length

      span.setAttribute(SemanticAttributes.CHAR_COUNT, charCount)
      span.setAttribute(SemanticAttributes.METHOD, 'digital')
      metrics.counter(Metrics.EXTRACT_UNIT_COUNT).add(1)

      return {
        text: markdown,
        charCount,
        extraction: {
          method: 'digital',
          reliability: 'high',
        },
      }
    })
  },

  getCliOptions(): CliOption[] {
    return [
      {
        flags: '--no-links',
        description: 'Strip links from HTML output (keep text)',
      },
      {
        flags: '--no-images',
        description: 'Strip images from HTML output',
      },
    ]
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fallback DOM parse when cached results are not available (direct plugin use).
 */
function parseDom(html: string): { textContent: string; langAttr: string } {
  const dom = new JSDOM(html)
  return {
    textContent: dom.window.document.body?.textContent ?? '',
    langAttr: dom.window.document.documentElement.getAttribute('lang')?.split('-')[0] ?? 'und',
  }
}

/**
 * Fetch HTML from URL (used when plugin is called directly, outside the processor).
 */
async function fetchHtml(url: string, timeout: number): Promise<{ bytes: Uint8Array }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'letmesense/1.0',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    return { bytes: new Uint8Array(buffer) }
  } finally {
    clearTimeout(timeoutId)
  }
}
