/**
 * OfficeParser v6 wrapper with type-safe interfaces.
 * Provides structured access to parsed Office document content.
 */

import officeParser from 'officeparser'

import { obs } from '../observability/index.js'
import { SemanticMetrics, SpanNames } from '../observability/types.js'
import { OfficeParseError } from './errors.js'
import type { DocumentMetadata, OfficeFormat } from './types.js'

// ============================================================================
// OfficeParser v6 Types (based on library API)
// ============================================================================

/** Text formatting options from OfficeParser */
export interface TextFormatting {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  color?: string
  size?: string
  font?: string
  alignment?: 'left' | 'center' | 'right' | 'justify'
}

/** Content node types from OfficeParser AST */
export type ContentNodeType =
  | 'paragraph'
  | 'heading'
  | 'text'
  | 'table'
  | 'row'
  | 'cell'
  | 'list'
  | 'image'
  | 'chart'
  | 'note'
  | 'slide'
  | 'sheet'
  | 'section'

/** A single content node in the AST */
export interface ContentNode {
  type: ContentNodeType
  text: string
  children?: ContentNode[]
  formatting?: TextFormatting
  metadata?: Record<string, unknown>
  rawContent?: string
}

/** Attachment (image/chart) from OfficeParser */
export interface ParsedAttachment {
  name: string
  type: 'image' | 'chart'
  data: string // Base64
  mimeType?: string
  ocrText?: string
  chartData?: {
    title?: string
    labels?: string[]
    dataSets?: Array<{
      name: string
      values: number[]
    }>
  }
}

/** The main AST returned by OfficeParser */
export interface ParsedDocument {
  /** Document type identifier */
  type: string
  /** Document metadata */
  metadata: {
    author?: string
    title?: string
    subject?: string
    keywords?: string[]
    created?: string
    modified?: string
    lastModifiedBy?: string
    revision?: number
    formatting?: unknown
    styleMap?: unknown
  }
  /** Content tree */
  content: ContentNode[]
  /** Extracted attachments (images, charts) */
  attachments: ParsedAttachment[]
  /** Get plain text (built-in method) */
  toText(): string
}

// ============================================================================
// Parser Options
// ============================================================================

/** Options for parsing Office documents */
export interface ParseOptions {
  /** Line break delimiter for text output */
  newlineDelimiter?: string
  /** Extract images and charts as Base64 */
  extractAttachments?: boolean
  /** Enable OCR for extracted images (requires Tesseract.js) */
  ocr?: boolean
  /** OCR language code(s) */
  ocrLanguage?: string
  /** Ignore notes (speaker notes in PPTX) */
  ignoreNotes?: boolean
  /** Put notes at the end instead of inline */
  putNotesAtLast?: boolean
  /** Include raw XML/RTF content in nodes */
  includeRawContent?: boolean
}

/** Default parsing options */
export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  newlineDelimiter: '\n\n',
  extractAttachments: true,
  ocr: false,
  ignoreNotes: false,
  putNotesAtLast: false,
  includeRawContent: false,
}

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse an Office document from a file path.
 *
 * @param filePath - Path to the Office document
 * @param options - Parsing options
 * @returns Parsed document AST
 */
export async function parseOfficeFile(
  filePath: string,
  options: ParseOptions = {},
): Promise<ParsedDocument> {
  const { tracer, metrics, logger } = obs('office.parser')

  return tracer.startSpan(SpanNames.OFFICE_PARSE_FILE, async (span) => {
    span.setAttribute('filePath', filePath)

    const opts = { ...DEFAULT_PARSE_OPTIONS, ...options }

    try {
      const ast = await officeParser.parseOffice(filePath, {
        newlineDelimiter: opts.newlineDelimiter,
        extractAttachments: opts.extractAttachments,
        ocr: opts.ocr,
        ocrLanguage: opts.ocrLanguage,
        ignoreNotes: opts.ignoreNotes,
        putNotesAtLast: opts.putNotesAtLast,
        includeRawContent: opts.includeRawContent,
      })

      const parsed = ast as ParsedDocument
      span.setAttribute('contentNodes', parsed.content.length)
      span.setAttribute('attachments', parsed.attachments.length)
      metrics.counter(SemanticMetrics.OFFICE_DOCUMENTS_PARSED_COUNT).add(1, { source: 'file' })
      logger.debug({ filePath, contentNodes: parsed.content.length }, 'Office file parsed')

      return parsed
    } catch (err) {
      throw new OfficeParseError(`Failed to parse Office document: ${filePath}`, err as Error)
    }
  })
}

/**
 * Parse an Office document from a buffer.
 *
 * @param buffer - Document buffer
 * @param options - Parsing options
 * @returns Parsed document AST
 */
export async function parseOfficeBuffer(
  buffer: Buffer | Uint8Array,
  options: ParseOptions = {},
): Promise<ParsedDocument> {
  const { tracer, metrics, logger } = obs('office.parser')

  return tracer.startSpan(SpanNames.OFFICE_PARSE_BUFFER, async (span) => {
    span.setAttribute('bufferSize', buffer.length)

    const opts = { ...DEFAULT_PARSE_OPTIONS, ...options }
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)

    try {
      const ast = await officeParser.parseOffice(buf, {
        newlineDelimiter: opts.newlineDelimiter,
        extractAttachments: opts.extractAttachments,
        ocr: opts.ocr,
        ocrLanguage: opts.ocrLanguage,
        ignoreNotes: opts.ignoreNotes,
        putNotesAtLast: opts.putNotesAtLast,
        includeRawContent: opts.includeRawContent,
      })

      const parsed = ast as ParsedDocument
      span.setAttribute('contentNodes', parsed.content.length)
      span.setAttribute('attachments', parsed.attachments.length)
      metrics.counter(SemanticMetrics.OFFICE_DOCUMENTS_PARSED_COUNT).add(1, { source: 'buffer' })
      logger.debug(
        { bufferSize: buffer.length, contentNodes: parsed.content.length },
        'Office buffer parsed',
      )

      return parsed
    } catch (err) {
      throw new OfficeParseError('Failed to parse Office document from buffer', err as Error)
    }
  })
}

// ============================================================================
// AST Traversal Utilities
// ============================================================================

/**
 * Recursively iterate over all nodes in the content tree.
 */
export function* walkContentNodes(nodes: ContentNode[]): Generator<ContentNode> {
  for (const node of nodes) {
    yield node
    if (node.children) {
      yield* walkContentNodes(node.children)
    }
  }
}

/**
 * Find all nodes of a specific type.
 */
export function findNodesByType(nodes: ContentNode[], type: ContentNodeType): ContentNode[] {
  return [...walkContentNodes(nodes)].filter((node) => node.type === type)
}

/**
 * Extract all text from content nodes.
 * Skips leaf 'text' nodes since their content is already in parent nodes' text property.
 */
export function extractTextFromNodes(nodes: ContentNode[], delimiter = '\n'): string {
  const texts: string[] = []

  for (const node of walkContentNodes(nodes)) {
    // Skip leaf 'text' nodes - their content is already in parent nodes' text
    if (node.type === 'text') continue

    if (node.text?.trim()) {
      texts.push(node.text.trim())
    }
  }

  return texts.join(delimiter)
}

/**
 * Count characters in content nodes (excluding whitespace).
 */
export function countCharsInNodes(nodes: ContentNode[]): number {
  let count = 0
  for (const node of walkContentNodes(nodes)) {
    if (node.text) {
      count += node.text.replace(/\s/g, '').length
    }
  }
  return count
}

/**
 * Count images in content nodes.
 */
export function countImagesInNodes(nodes: ContentNode[]): number {
  return findNodesByType(nodes, 'image').length
}

/**
 * Get text sample from content nodes (first N characters).
 */
export function getTextSample(nodes: ContentNode[], maxChars = 400): string {
  const text = extractTextFromNodes(nodes, ' ')
  return text.slice(0, maxChars)
}

// ============================================================================
// Metadata Extraction
// ============================================================================

/**
 * Convert OfficeParser metadata to our DocumentMetadata type.
 */
export function extractMetadata(parsed: ParsedDocument): DocumentMetadata {
  const meta = parsed.metadata

  return {
    author: meta.author,
    title: meta.title,
    subject: meta.subject,
    keywords: meta.keywords,
    created: meta.created ? new Date(meta.created) : undefined,
    modified: meta.modified ? new Date(meta.modified) : undefined,
    lastModifiedBy: meta.lastModifiedBy,
    revision: meta.revision,
  }
}

// ============================================================================
// Format-Specific Utilities
// ============================================================================

/**
 * Get slides from a PPTX document.
 */
export function getSlides(parsed: ParsedDocument): ContentNode[] {
  // In PPTX, top-level content nodes are typically slides
  // or we need to find 'slide' type nodes
  const slides = findNodesByType(parsed.content, 'slide')
  if (slides.length > 0) return slides

  // Fallback: treat each top-level node as a slide
  return parsed.content
}

/**
 * Get sheets from an XLSX document.
 */
export function getSheets(parsed: ParsedDocument): ContentNode[] {
  const sheets = findNodesByType(parsed.content, 'sheet')
  if (sheets.length > 0) return sheets

  // Fallback: look for tables as sheets
  return findNodesByType(parsed.content, 'table')
}

/**
 * Get sections from a DOCX document.
 */
export function getSections(parsed: ParsedDocument): ContentNode[] {
  const sections = findNodesByType(parsed.content, 'section')
  if (sections.length > 0) return sections

  // Fallback: split by headings
  const result: ContentNode[] = []
  let currentSection: ContentNode[] = []

  for (const node of parsed.content) {
    if (node.type === 'heading') {
      if (currentSection.length > 0) {
        result.push({
          type: 'section',
          text: '',
          children: currentSection,
        })
      }
      currentSection = [node]
    } else {
      currentSection.push(node)
    }
  }

  if (currentSection.length > 0) {
    result.push({
      type: 'section',
      text: '',
      children: currentSection,
    })
  }

  return result.length > 0 ? result : [{ type: 'section', text: '', children: parsed.content }]
}

/**
 * Get content units based on document format.
 */
export function getContentUnits(parsed: ParsedDocument, format: OfficeFormat): ContentNode[] {
  switch (format) {
    case 'pptx':
    case 'odp':
      return getSlides(parsed)

    case 'xlsx':
    case 'ods':
      return getSheets(parsed)

    case 'docx':
    case 'odt':
      return getSections(parsed)

    default:
      return parsed.content
  }
}

/**
 * Get speaker notes from a slide node (PPTX).
 */
export function getSlideNotes(slide: ContentNode): string | undefined {
  const notes = findNodesByType(slide.children ?? [], 'note')
  if (notes.length === 0) return undefined
  return extractTextFromNodes(notes)
}

/**
 * Get table data as 2D array from a table/sheet node.
 */
export function getTableData(tableNode: ContentNode): (string | number | boolean | null)[][] {
  const rows = findNodesByType(tableNode.children ?? [], 'row')
  return rows.map((row) => {
    const cells = findNodesByType(row.children ?? [], 'cell')
    return cells.map((cell) => {
      const text = cell.text?.trim() ?? ''
      // Try to parse as number
      const num = parseFloat(text)
      if (!Number.isNaN(num) && text === String(num)) return num
      // Try to parse as boolean
      if (text.toLowerCase() === 'true') return true
      if (text.toLowerCase() === 'false') return false
      // Return as string or null
      return text || null
    })
  })
}
