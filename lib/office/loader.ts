/**
 * Office document loading utilities.
 * Handles file/URL/buffer input and format detection.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { DEFAULT_FETCH_TIMEOUT_MS } from '../common/timeouts.js'
import { obs, SemanticAttributes } from '../observability/index.js'
import { OfficeLoadError } from './errors.js'
import { Metrics, Spans } from './signals.js'
import type { OfficeFormat, OfficeInput } from './types.js'

/** Supported file extensions mapped to formats */
const EXTENSION_MAP: Record<string, OfficeFormat> = {
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
  '.odt': 'odt',
  '.odp': 'odp',
  '.ods': 'ods',
}

/** MIME types for Office formats */
const MIME_MAP: Record<string, OfficeFormat> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
}

/** ZIP file magic bytes */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/** Result of loading an Office document */
export interface LoadResult {
  /** Document bytes */
  bytes: Buffer
  /** Detected format */
  format: OfficeFormat
  /** Original source (path, URL, or 'stdin') */
  source: string
}

/**
 * Detect input type from the input value.
 */
export function detectInputType(input: OfficeInput): 'file' | 'url' | 'bytes' {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return 'bytes'
  }
  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return 'url'
    }
    return 'file'
  }
  throw new OfficeLoadError(`Invalid input type: ${typeof input}`)
}

/**
 * Detect Office format from file extension.
 */
export function detectFormatFromExtension(filePath: string): OfficeFormat | null {
  const ext = extname(filePath).toLowerCase()
  return EXTENSION_MAP[ext] ?? null
}

/**
 * Detect Office format from MIME type.
 */
export function detectFormatFromMime(mimeType: string): OfficeFormat | null {
  return MIME_MAP[mimeType] ?? null
}

/**
 * Detect Office format from buffer content.
 * Checks for ZIP magic bytes and tries to identify the format.
 */
export function detectFormatFromBytes(bytes: Buffer): OfficeFormat | null {
  // Check ZIP magic bytes
  if (bytes.length < 4) return null

  const isZip = ZIP_MAGIC.every((b, i) => bytes[i] === b)
  if (!isZip) return null

  // For Office Open XML, we'd need to peek inside the ZIP
  // to check [Content_Types].xml, but that's expensive.
  // Return null and require format to be specified or detected from extension.
  return null
}

/**
 * Load Office document from file path.
 */
async function loadFromFile(filePath: string): Promise<LoadResult> {
  if (!existsSync(filePath)) {
    throw new OfficeLoadError(`File not found: ${filePath}`)
  }

  const format = detectFormatFromExtension(filePath)
  if (!format) {
    throw new OfficeLoadError(
      `Unsupported file extension: ${extname(filePath)}. ` +
        `Supported: ${Object.keys(EXTENSION_MAP).join(', ')}`,
    )
  }

  try {
    const bytes = await readFile(filePath)
    return { bytes, format, source: filePath }
  } catch (err) {
    throw new OfficeLoadError(`Failed to read file: ${filePath}`, err as Error)
  }
}

/**
 * Load Office document from URL.
 */
async function loadFromUrl(url: string, timeout = DEFAULT_FETCH_TIMEOUT_MS): Promise<LoadResult> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'letmesense-office/1.0',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new OfficeLoadError(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    const arrayBuffer = await response.arrayBuffer()
    const bytes = Buffer.from(arrayBuffer)

    // Try to detect format from Content-Type header
    let format = detectFormatFromMime(contentType.split(';')[0].trim())

    // Fall back to URL extension
    if (!format) {
      const urlPath = new URL(url).pathname
      format = detectFormatFromExtension(urlPath)
    }

    if (!format) {
      throw new OfficeLoadError(
        `Could not detect format from URL: ${url}. ` +
          `Content-Type: ${contentType}. ` +
          `Please ensure the URL points to a supported Office file.`,
      )
    }

    return { bytes, format, source: url }
  } catch (err) {
    if (err instanceof OfficeLoadError) throw err
    throw new OfficeLoadError(`Failed to fetch URL: ${url}`, err as Error)
  }
}

/**
 * Load Office document from buffer.
 * Requires format to be specified since we can't reliably detect it from bytes alone.
 */
function loadFromBytes(bytes: Buffer | Uint8Array, format: OfficeFormat): LoadResult {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  return { bytes: buffer, format, source: 'buffer' }
}

/** Options for loading Office documents */
export interface LoadOptions {
  /** Explicitly specify format (required for buffer input without extension) */
  format?: OfficeFormat
  /** Timeout for URL fetching in milliseconds */
  timeout?: number
}

/**
 * Load an Office document from file, URL, or buffer.
 *
 * @param input - File path, URL, or buffer
 * @param options - Loading options
 * @returns Loaded document bytes, detected format, and source
 *
 * @example
 * ```ts
 * // From file
 * const result = await loadOfficeDocument('presentation.pptx')
 *
 * // From URL
 * const result = await loadOfficeDocument('https://example.com/doc.docx')
 *
 * // From buffer (format required)
 * const result = await loadOfficeDocument(buffer, { format: 'xlsx' })
 * ```
 */
export async function loadOfficeDocument(
  input: OfficeInput,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const { tracer, metrics, logger } = obs('office.loader')

  return tracer.startSpan(Spans.LOAD_DOCUMENT, async (span) => {
    const inputType = detectInputType(input)
    span.setAttribute(SemanticAttributes.INPUT_TYPE, inputType)

    let result: LoadResult

    switch (inputType) {
      case 'file':
        result = await loadFromFile(input as string)
        break

      case 'url':
        result = await loadFromUrl(input as string, options.timeout)
        break

      case 'bytes': {
        const format = options.format
        if (!format) {
          throw new OfficeLoadError(
            'Format must be specified when loading from buffer. ' +
              'Use options.format to specify the document format.',
          )
        }
        result = loadFromBytes(input as Buffer | Uint8Array, format)
        break
      }

      default:
        throw new OfficeLoadError(`Unknown input type: ${inputType}`)
    }

    span.setAttribute(SemanticAttributes.FORMAT, result.format)
    span.setAttribute(SemanticAttributes.BYTES, result.bytes.length)
    span.setAttribute(SemanticAttributes.SOURCE, result.source)
    metrics.counter(Metrics.DOCUMENT_LOADED_COUNT).add(1, { format: result.format, inputType })
    metrics.histogram(Metrics.DOCUMENT_BYTES).record(result.bytes.length, { format: result.format })
    logger.debug(
      { format: result.format, bytes: result.bytes.length, source: result.source },
      'Office document loaded',
    )

    return result
  })
}

/**
 * Check if a file path or URL points to a supported Office format.
 */
export function isSupportedFormat(pathOrUrl: string): boolean {
  const format = detectFormatFromExtension(pathOrUrl)
  return format !== null
}

/**
 * Get list of supported file extensions.
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_MAP)
}

/**
 * Get list of supported formats.
 */
export function getSupportedFormats(): OfficeFormat[] {
  return [...new Set(Object.values(EXTENSION_MAP))]
}
