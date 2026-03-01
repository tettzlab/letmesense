/**
 * HTML/web-specific types for the unified extraction pipeline.
 * Extends pipeline core types with web-specific attributes.
 */

import type { LoadedDocument } from '../../pipeline/plugin.js'
import type { ContentKind, DocumentUnit } from '../../pipeline/types.js'

// ============================================================================
// Web Unit
// ============================================================================

/**
 * An HTML document as a single document unit.
 * Web pages are single-unit documents (no pages/slides).
 */
export interface WebUnit extends DocumentUnit {
  /** Document title from Readability or <title> */
  title?: string

  /** Source URL (if loaded from URL) */
  url?: string

  /** Author extracted by Readability */
  author?: string

  /** Published date extracted by Readability */
  publishedDate?: string

  /** Site name extracted by Readability */
  siteName?: string

  /** Short excerpt extracted by Readability */
  excerpt?: string

  /** Original HTML byte size */
  htmlByteSize: number

  /** Whether Readability successfully extracted content */
  readabilitySuccess: boolean
}

// ============================================================================
// Web Loaded Document
// ============================================================================

/** Cached Readability parse result to avoid redundant JSDOM parsing. */
export interface ReadabilityResult {
  title?: string | null
  content?: string | null
  textContent?: string | null
  byline?: string | null
  publishedTime?: string | null
  siteName?: string | null
  excerpt?: string | null
}

/**
 * A loaded HTML document.
 */
export interface WebLoadedDocument extends LoadedDocument {
  /** Decoded HTML string */
  html: string

  /** Original file path or URL */
  source: string

  /** Cached DOM parse results from parse() phase, reused by analyzeUnit/extractUnit */
  cached?: {
    article: ReadabilityResult | null
    textContent: string
    langAttr: string
  }
}

// ============================================================================
// Web Options
// ============================================================================

/**
 * Options for HTML extraction.
 */
export interface WebExtractOptions extends Record<string, unknown> {
  /** Include links in markdown output (default: true) */
  includeLinks?: boolean

  /** Include images in markdown output (default: true) */
  includeImages?: boolean

  /** Fetch timeout for URL inputs (ms) */
  fetchTimeout?: number

  /** Source URL set by the processor when it pre-resolves an HTTP URL */
  sourceUrl?: string
}

// ============================================================================
// Mapping Functions
// ============================================================================

/** Element counts used for content classification. */
export interface HtmlElementCounts {
  charCount: number
  imageCount: number
  tableCount: number
}

/**
 * Classify HTML content based on element composition.
 */
export function classifyHtml(counts: HtmlElementCounts): ContentKind {
  const { charCount, imageCount, tableCount } = counts
  if (charCount === 0 && imageCount === 0) return 'empty'
  if (tableCount > 0 && charCount > 0) return 'tabular'
  if (charCount === 0 && imageCount > 0) return 'image-only'
  if (charCount > 0 && imageCount > 0) return 'mixed'
  return 'text-only'
}
