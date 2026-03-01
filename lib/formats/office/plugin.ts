/**
 * Office plugin for the unified extraction pipeline.
 * Adapts existing lib/office/ code to the FormatPlugin interface.
 * Supports: DOCX, PPTX, XLSX, ODT, ODP, ODS
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_FETCH_TIMEOUT_MS, DEFAULT_PAGE_TIMEOUT_MS } from '../../common/timeouts.js'
import { obs, SemanticAttributes } from '../../observability/index.js'
import { analyzeSingleUnit } from '../../office/analyze.js'
import { classifyContentKind } from '../../office/classify.js'
import { checkLibreOffice, convertToPdf } from '../../office/convert/libreoffice.js'
import { extractSingleUnit } from '../../office/extractText.js'
import {
  detectFormatFromExtension,
  type LoadResult,
  loadOfficeDocument,
} from '../../office/loader.js'
import { extractMetadata, getContentUnits, parseOfficeBuffer } from '../../office/parser.js'
import type {
  ContentAttributes,
  OfficeFormat,
  SectionAttributes,
  SheetAttributes,
  SlideAttributes,
} from '../../office/types.js'
import { loadPdfDocumentFromBytes } from '../../pdf/pdfjs.js'
import { cleanupPdfDocument } from '../../pdf/pdfjsTypes.js'
import { renderPage } from '../../pdf/render.js'
import type { CliOption, FormatPlugin, RenderedContent } from '../../pipeline/plugin.js'
import type { ContentKind, FormatId, UnitExtractionResult } from '../../pipeline/types.js'
import { Metrics, Spans } from './signals.js'
import type { OfficeExtractOptions, OfficeLoadedDocument, OfficeUnit } from './types.js'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_UNIT_TIMEOUT_MS = DEFAULT_PAGE_TIMEOUT_MS
const DEFAULT_VISION_RENDER_SCALE = 2.0

/** Map Office format to file extension */
const FORMAT_EXTENSIONS: Record<OfficeFormat, string> = {
  docx: '.docx',
  pptx: '.pptx',
  xlsx: '.xlsx',
  odt: '.odt',
  odp: '.odp',
  ods: '.ods',
}

// ============================================================================
// Office Plugin Implementation
// ============================================================================

export const officePlugin: FormatPlugin<OfficeUnit, OfficeExtractOptions> = {
  // -------------------- Identity --------------------

  // Note: id is 'docx' but this plugin handles all Office formats via shared extraction
  id: 'docx',
  name: 'Microsoft Office / OpenDocument',
  extensions: [
    '.docx',
    '.DOCX',
    '.pptx',
    '.PPTX',
    '.xlsx',
    '.XLSX',
    '.odt',
    '.ODT',
    '.odp',
    '.ODP',
    '.ods',
    '.ODS',
  ],
  mimeTypes: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.spreadsheet',
  ],

  capabilities: {
    ocr: false, // OCR for embedded images not yet implemented
    vision: true, // Vision extraction via LibreOffice PDF conversion
    streaming: false,
    parallel: true,
    supportsRuns: true,
    multiUnit: true,
  },

  // -------------------- Lifecycle --------------------

  async load(input, options = {}): Promise<OfficeLoadedDocument> {
    const { tracer, metrics, logger } = obs('office.plugin')
    const { fetchTimeout = DEFAULT_FETCH_TIMEOUT_MS, format: optionsFormat } = options

    return tracer.startSpan(Spans.LOAD, async (span) => {
      const inputType =
        input instanceof Uint8Array || Buffer.isBuffer(input)
          ? 'buffer'
          : typeof input === 'string' && input.startsWith('http')
            ? 'url'
            : 'file'
      span.setAttribute(SemanticAttributes.INPUT_TYPE, inputType)

      // Detect format for buffer inputs
      let formatHint: OfficeFormat | undefined
      if (typeof input === 'string' && !input.startsWith('http')) {
        formatHint = detectFormatFromExtension(input) ?? undefined
      }
      // Also check if format was provided in options (e.g., from --input-format)
      if (!formatHint && optionsFormat) {
        formatHint = optionsFormat as OfficeFormat
      }

      // Load the document
      let loadResult: LoadResult
      if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
        // For buffer input, we need format to be specified
        if (!formatHint) {
          throw new Error('Format must be specified when loading from buffer')
        }
        loadResult = await loadOfficeDocument(input, { format: formatHint, timeout: fetchTimeout })
      } else {
        loadResult = await loadOfficeDocument(input as string, { timeout: fetchTimeout })
      }

      const { bytes, format, source } = loadResult
      span.setAttribute(SemanticAttributes.FORMAT, format)
      span.setAttribute(SemanticAttributes.BYTES, bytes.length)

      // Parse the document
      const parsed = await parseOfficeBuffer(bytes, {
        newlineDelimiter: '\n\n',
        extractAttachments: true,
        ignoreNotes: false,
      })

      // Store a copy of bytes (similar to PDF plugin ArrayBuffer fix)
      const storedBytes = new Uint8Array(bytes)

      // Determine file path for vision mode
      let filePath: string | undefined
      let tempFilePath: string | undefined

      if (typeof input === 'string' && !input.startsWith('http')) {
        // File path input - use directly
        filePath = input
      } else if (typeof input === 'string' && input.startsWith('http')) {
        // URL input - save to temp file for LibreOffice
        const tempDir = join(tmpdir(), `office-vision-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        const ext = FORMAT_EXTENSIONS[format]
        tempFilePath = join(tempDir, `document${ext}`)
        await writeFile(tempFilePath, bytes)
        filePath = tempFilePath
      } else {
        // Buffer input - save to temp file for LibreOffice
        const tempDir = join(tmpdir(), `office-vision-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        const ext = FORMAT_EXTENSIONS[format]
        tempFilePath = join(tempDir, `document${ext}`)
        await writeFile(tempFilePath, bytes)
        filePath = tempFilePath
      }

      metrics.counter(Metrics.LOAD_COUNT).add(1, { format })
      metrics.histogram(Metrics.LOAD_BYTES).record(bytes.length, { format })
      logger.debug({ format, bytes: bytes.length, source }, 'Office document loaded')

      return {
        bytes: storedBytes,
        format: mapOfficeFormatToFormatId(format),
        officeFormat: format,
        parsed,
        source,
        filePath,
        tempFilePath,
      }
    })
  },

  async parse(doc): Promise<{ units: OfficeUnit[]; metadata?: Record<string, unknown> }> {
    const { tracer, metrics } = obs('office.plugin')
    const { parsed, officeFormat } = doc as OfficeLoadedDocument

    return tracer.startSpan(Spans.PARSE, async (span) => {
      span.setAttribute(SemanticAttributes.FORMAT, officeFormat)
      const contentUnits = getContentUnits(parsed, officeFormat)
      const units: OfficeUnit[] = []

      for (let i = 0; i < contentUnits.length; i++) {
        const node = contentUnits[i]
        const label = generateUnitLabel(officeFormat, i, node)

        units.push({
          index: i,
          label,
          kind: 'unknown',
          charCount: 0,
          language: 'und',
          textSample: '',
          unitLabel: label,
          imageCount: 0,
          officeKind: 'unknown',
        })
      }

      // Extract document metadata
      const docMetadata = extractMetadata(parsed)
      const metadata: Record<string, unknown> = {
        title: docMetadata.title,
        author: docMetadata.author,
        subject: docMetadata.subject,
        keywords: docMetadata.keywords,
        created: docMetadata.created,
        modified: docMetadata.modified,
        lastModifiedBy: docMetadata.lastModifiedBy,
        revision: docMetadata.revision,
      }

      span.setAttribute(SemanticAttributes.UNIT_COUNT, units.length)
      metrics.counter(Metrics.UNIT_COUNT).add(units.length, { format: officeFormat })

      return { units, metadata }
    })
  },

  async analyzeUnit(unit, doc): Promise<OfficeUnit> {
    const { tracer, metrics } = obs('office.plugin')
    const { parsed, officeFormat } = doc as OfficeLoadedDocument

    return tracer.startSpan(Spans.ANALYZE_UNIT, async (span) => {
      span.setAttribute(SemanticAttributes.UNIT_INDEX, unit.index)
      span.setAttribute(SemanticAttributes.FORMAT, officeFormat)

      const attr = analyzeSingleUnit(parsed, unit.index, officeFormat)

      if (!attr || attr.error) {
        span.setAttribute('kind', 'unknown')
        return {
          ...unit,
          kind: 'unknown',
          officeKind: 'unknown',
        }
      }

      span.setAttribute(SemanticAttributes.CHAR_COUNT, attr.charCount)
      span.setAttribute('kind', attr.kind)
      span.setAttribute(SemanticAttributes.LANGUAGE, attr.language)
      metrics.counter(Metrics.ANALYZE_UNIT_COUNT).add(1, { format: officeFormat, kind: attr.kind })

      // Map format-specific attributes
      const updated: OfficeUnit = {
        ...unit,
        charCount: attr.charCount,
        language: attr.language,
        textSample: attr.textSample,
        unitLabel: attr.unitLabel,
        imageCount: attr.imageCount,
        officeKind: attr.kind,
        kind: attr.kind,
      }

      // Add format-specific fields
      if (isSlideAttributes(attr)) {
        updated.slideNumber = attr.slideNumber
        updated.hasNotes = attr.hasNotes
        updated.notesText = attr.notesText
      } else if (isSheetAttributes(attr)) {
        updated.sheetName = attr.sheetName
        updated.rowCount = attr.rowCount
        updated.columnCount = attr.columnCount
      } else if (isSectionAttributes(attr)) {
        updated.headingLevel = attr.headingLevel
        updated.headingText = attr.headingText
        updated.hasTables = attr.hasTables
      }

      return updated
    })
  },

  classifyUnit(unit): ContentKind {
    return classifyContentKind({
      charCount: unit.charCount,
      imageCount: unit.imageCount,
    })
  },

  buildRunKey(unit): string {
    // Office uses 2 dimensions: kind|language
    return `${unit.kind}|${unit.language}`
  },

  async extractUnit(unit, doc, options = {}): Promise<UnitExtractionResult> {
    const { tracer, metrics } = obs('office.plugin')
    const { parsed, officeFormat } = doc as OfficeLoadedDocument
    const { includeNotes = true, unitTimeout = DEFAULT_UNIT_TIMEOUT_MS } = options

    return tracer.startSpan(Spans.EXTRACT_UNIT, async (span) => {
      span.setAttribute(SemanticAttributes.UNIT_INDEX, unit.index)
      span.setAttribute(SemanticAttributes.FORMAT, officeFormat)
      span.setAttribute('kind', unit.kind)

      const extracted = extractSingleUnit(parsed, unit.index, officeFormat, unit.kind, {
        includeNotes,
        unitTimeout,
      })

      if (extracted.error) {
        span.setAttribute(SemanticAttributes.CHAR_COUNT, 0)
        span.setAttribute(SemanticAttributes.STATUS, 'error')
        metrics
          .counter(Metrics.EXTRACT_UNIT_COUNT)
          .add(1, { format: officeFormat, status: 'error' })
        return {
          text: '',
          charCount: 0,
          extraction: {
            method: 'digital',
            reliability: 'low',
          },
        }
      }

      const charCount = extracted.text.replace(/\s+/g, '').length
      span.setAttribute(SemanticAttributes.CHAR_COUNT, charCount)
      span.setAttribute(SemanticAttributes.STATUS, 'success')
      metrics
        .counter(Metrics.EXTRACT_UNIT_COUNT)
        .add(1, { format: officeFormat, status: 'success' })
      metrics.histogram(Metrics.EXTRACT_CHARS).record(charCount, { format: officeFormat })

      return {
        text: extracted.text,
        charCount,
        extraction: {
          method: 'digital',
          reliability: unit.kind === 'image-only' ? 'low' : 'exact',
        },
      }
    })
  },

  async renderUnit(unit, doc, options = {}): Promise<RenderedContent> {
    const { tracer, metrics, logger } = obs('office.plugin')
    const officeDoc = doc as OfficeLoadedDocument
    const { scale = DEFAULT_VISION_RENDER_SCALE } = options

    return tracer.startSpan(Spans.RENDER_UNIT, async (span) => {
      span.setAttribute(SemanticAttributes.UNIT_INDEX, unit.index)
      span.setAttribute(SemanticAttributes.FORMAT, officeDoc.officeFormat)
      span.setAttribute(SemanticAttributes.SCALE, scale)

      // Check LibreOffice availability
      const status = checkLibreOffice()
      if (!status.available) {
        throw new Error(
          `LibreOffice is required for Office vision mode. ${status.error ?? 'Install LibreOffice to use this feature.'}`,
        )
      }

      // Ensure we have a file path (should be set in load())
      if (!officeDoc.filePath) {
        throw new Error('Cannot render unit: no file path available for LibreOffice conversion')
      }
      const filePath = officeDoc.filePath

      // Convert to PDF if not already cached
      if (!officeDoc.cachedPdf) {
        await tracer.startSpan(Spans.CONVERT_TO_PDF, async (convertSpan) => {
          convertSpan.setAttribute(SemanticAttributes.FORMAT, officeDoc.officeFormat)
          const tempDir = join(tmpdir(), `office-pdf-${Date.now()}`)
          await mkdir(tempDir, { recursive: true })

          try {
            const result = await convertToPdf(filePath, { outputDir: tempDir })

            // Read the PDF file
            const { readFile } = await import('node:fs/promises')
            const pdfBytes = await readFile(result.outputPath)

            // Create a copy of the bytes to avoid buffer detachment issues
            // When pdfjs transfers the buffer internally, we need our own copy
            const pdfArray = new Uint8Array(pdfBytes.buffer.slice(0))

            // Load PDF document and keep it open for reuse
            const pdfDoc = await loadPdfDocumentFromBytes(pdfArray)
            const pageCount = pdfDoc.numPages

            // Cache the loaded PDF document (not just bytes)
            officeDoc.cachedPdf = {
              doc: pdfDoc,
              pageCount,
            }

            convertSpan.setAttribute(SemanticAttributes.PAGE_COUNT, pageCount)
            convertSpan.setAttribute('pdfBytes', pdfArray.length)
            metrics.counter(Metrics.PDF_CONVERSION_COUNT).add(1, { format: officeDoc.officeFormat })
            logger.debug({ format: officeDoc.officeFormat, pageCount }, 'Converted to PDF')

            // Clean up temp PDF directory
            await rm(tempDir, { recursive: true, force: true }).catch((e) => {
              logger.warn({ err: e, tempDir }, 'Failed to clean up temp directory')
            })
          } catch (err) {
            // Clean up on error
            await rm(tempDir, { recursive: true, force: true }).catch((e) => {
              logger.warn({ err: e, tempDir }, 'Failed to clean up temp directory on error')
            })
            throw new Error(
              `Failed to convert document to PDF: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        })
      }

      // Map unit index to PDF page (1-indexed)
      const pageNumber = unit.index + 1
      const cachedPdf = officeDoc.cachedPdf
      if (!cachedPdf) {
        throw new Error('PDF conversion failed: no cached PDF available')
      }
      if (pageNumber > cachedPdf.pageCount) {
        throw new Error(
          `Unit ${unit.index} maps to page ${pageNumber} but PDF only has ${cachedPdf.pageCount} pages`,
        )
      }

      // Use the cached PDF document (already loaded during conversion)
      const page = await cachedPdf.doc.getPage(pageNumber)
      const rendered = await renderPage(page, { scale, format: 'png' })

      span.setAttribute(SemanticAttributes.WIDTH, rendered.width)
      span.setAttribute(SemanticAttributes.HEIGHT, rendered.height)
      span.setAttribute(SemanticAttributes.BYTES, rendered.buffer.length)
      metrics.counter(Metrics.RENDER_UNIT_COUNT).add(1, { format: officeDoc.officeFormat })
      metrics
        .histogram(Metrics.RENDER_BYTES)
        .record(rendered.buffer.length, { format: officeDoc.officeFormat })

      return {
        base64: rendered.buffer.toString('base64'),
        mimeType: 'image/png',
        width: rendered.width,
        height: rendered.height,
      }
    })
  },

  async cleanup(doc): Promise<void> {
    const officeDoc = doc as OfficeLoadedDocument

    // Clean up cached PDF document if we created one
    if (officeDoc.cachedPdf?.doc) {
      await cleanupPdfDocument(officeDoc.cachedPdf.doc)
    }

    // Clean up temp file if we created one (for URL/buffer inputs)
    if (officeDoc.tempFilePath) {
      try {
        // Get parent directory of temp file
        const { dirname } = await import('node:path')
        const tempDir = dirname(officeDoc.tempFilePath)
        await rm(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    }
  },

  getCliOptions(): CliOption[] {
    return [
      {
        flags: '--include-notes',
        description: 'Include speaker notes (PPTX)',
        defaultValue: true,
      },
      {
        flags: '--slide-range <range>',
        description: 'Slide range to extract (PPTX): "1-5,7,9-12"',
      },
      {
        flags: '--sheet-names <names>',
        description: 'Sheet names to extract (XLSX): "Sheet1,Sheet2"',
      },
      {
        flags: '--headers',
        description: 'Treat first row as headers (XLSX)',
        defaultValue: false,
      },
      {
        flags: '--unit-timeout <ms>',
        description: 'Per-unit timeout in milliseconds',
        defaultValue: 60000,
      },
    ]
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Map OfficeFormat to pipeline FormatId.
 */
function mapOfficeFormatToFormatId(format: OfficeFormat): FormatId {
  // Office formats map directly to FormatId
  return format
}

/**
 * Generate a label for a content unit.
 */
function generateUnitLabel(
  format: OfficeFormat,
  index: number,
  node: { metadata?: Record<string, unknown> },
): string {
  switch (format) {
    case 'pptx':
    case 'odp':
      return `Slide ${index + 1}`

    case 'xlsx':
    case 'ods': {
      const sheetName = (node.metadata?.sheetName as string) ?? `Sheet ${index + 1}`
      return `Sheet: ${sheetName}`
    }

    case 'docx':
    case 'odt':
      return `Section ${index + 1}`

    default:
      return `Unit ${index + 1}`
  }
}

/**
 * Type guard for SlideAttributes.
 */
function isSlideAttributes(attr: ContentAttributes): attr is SlideAttributes {
  return 'slideNumber' in attr
}

/**
 * Type guard for SheetAttributes.
 */
function isSheetAttributes(attr: ContentAttributes): attr is SheetAttributes {
  return 'sheetName' in attr
}

/**
 * Type guard for SectionAttributes.
 */
function isSectionAttributes(attr: ContentAttributes): attr is SectionAttributes {
  return 'hasTables' in attr
}
