/**
 * Plugin registry for the unified extraction pipeline.
 * Manages format plugins and provides format detection.
 */

import { obs } from '../observability/index.js'
import { SemanticMetrics } from '../observability/types.js'
import type { FormatPlugin } from './plugin.js'
import type { DocumentInput, FormatId } from './types.js'

// ============================================================================
// Magic Bytes
// ============================================================================

/** Magic byte signatures for format detection */
const MAGIC_BYTES: Array<{ signature: number[]; format: FormatId }> = [
  // PDF: %PDF
  { signature: [0x25, 0x50, 0x44, 0x46], format: 'pdf' },
  // ZIP-based (Office Open XML): PK
  { signature: [0x50, 0x4b, 0x03, 0x04], format: 'docx' }, // Will be refined by extension
  // ODF (also ZIP-based)
  // PNG
  { signature: [0x89, 0x50, 0x4e, 0x47], format: 'image' },
  // JPEG
  { signature: [0xff, 0xd8, 0xff], format: 'image' },
  // GIF
  { signature: [0x47, 0x49, 0x46, 0x38], format: 'image' },
  // Note: WebP uses RIFF container but needs special handling (see detectFormatFromBytes)
]

/** WebP magic bytes: RIFF....WEBP (offset 8-11 must be "WEBP") */
const WEBP_RIFF_HEADER = [0x52, 0x49, 0x46, 0x46] // "RIFF"
const WEBP_MARKER = [0x57, 0x45, 0x42, 0x50] // "WEBP" at offset 8

/** MIME type to format mapping */
const MIME_TO_FORMAT: Record<string, FormatId> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
}

/** Extension to format mapping */
const EXT_TO_FORMAT: Record<string, FormatId> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
  '.odt': 'odt',
  '.odp': 'odp',
  '.ods': 'ods',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
}

// ============================================================================
// Plugin Registry
// ============================================================================

/**
 * Registry for format plugins.
 * Provides lookup by format ID, extension, and MIME type.
 */
export class PluginRegistry {
  private plugins = new Map<FormatId, FormatPlugin>()
  private extensionMap = new Map<string, FormatId>()
  private mimeMap = new Map<string, FormatId>()

  /**
   * Register a format plugin.
   * Overwrites any existing plugin with the same ID.
   */
  register(plugin: FormatPlugin): void {
    this.plugins.set(plugin.id, plugin)

    // Build extension lookup
    for (const ext of plugin.extensions) {
      this.extensionMap.set(ext.toLowerCase(), plugin.id)
    }

    // Build MIME type lookup
    for (const mime of plugin.mimeTypes) {
      this.mimeMap.set(mime.toLowerCase(), plugin.id)
    }
  }

  /**
   * Get a plugin by format ID.
   */
  get(id: FormatId): FormatPlugin | undefined {
    return this.plugins.get(id)
  }

  /**
   * Check if a plugin is registered for a format.
   */
  has(id: FormatId): boolean {
    return this.plugins.has(id)
  }

  /**
   * Get a plugin by file extension.
   * Extension should include the dot (e.g., ".pdf").
   */
  getByExtension(ext: string): FormatPlugin | undefined {
    const formatId = this.extensionMap.get(ext.toLowerCase())
    return formatId ? this.plugins.get(formatId) : undefined
  }

  /**
   * Get a plugin by MIME type.
   */
  getByMimeType(mimeType: string): FormatPlugin | undefined {
    const formatId = this.mimeMap.get(mimeType.toLowerCase())
    return formatId ? this.plugins.get(formatId) : undefined
  }

  /**
   * Detect format from input and return appropriate plugin.
   * Priority: explicit format > extension > MIME type > magic bytes.
   */
  detectFormat(
    input: DocumentInput,
    options?: { format?: FormatId; mimeType?: string },
  ): { format: FormatId; plugin: FormatPlugin } | null {
    const { metrics } = obs('pipeline.registry')
    let detectionMethod = 'unknown'

    // 1. Explicit format override
    if (options?.format) {
      const plugin = this.plugins.get(options.format)
      if (plugin) {
        detectionMethod = 'explicit'
        metrics
          .counter(SemanticMetrics.PIPELINE_FORMAT_DETECTED_COUNT)
          .add(1, { format: options.format, method: detectionMethod })
        return { format: options.format, plugin }
      }
    }

    // 2. Try extension (for file paths and URLs)
    if (typeof input === 'string') {
      const ext = getExtension(input)
      if (ext) {
        const plugin = this.getByExtension(ext)
        if (plugin) {
          // Use detected format if known, otherwise fall back to plugin ID
          const format = detectFormatFromExtension(ext) ?? plugin.id
          detectionMethod = 'extension'
          metrics
            .counter(SemanticMetrics.PIPELINE_FORMAT_DETECTED_COUNT)
            .add(1, { format, method: detectionMethod })
          return { format, plugin }
        }
      }
    } else if (input instanceof URL) {
      const ext = getExtension(input.pathname)
      if (ext) {
        const plugin = this.getByExtension(ext)
        if (plugin) {
          // Use detected format if known, otherwise fall back to plugin ID
          const format = detectFormatFromExtension(ext) ?? plugin.id
          detectionMethod = 'extension'
          metrics
            .counter(SemanticMetrics.PIPELINE_FORMAT_DETECTED_COUNT)
            .add(1, { format, method: detectionMethod })
          return { format, plugin }
        }
      }
    }

    // 3. Try MIME type
    if (options?.mimeType) {
      const plugin = this.getByMimeType(options.mimeType)
      if (plugin) {
        // Use detected format if known, otherwise fall back to plugin ID
        const format = detectFormatFromMime(options.mimeType) ?? plugin.id
        detectionMethod = 'mime'
        metrics
          .counter(SemanticMetrics.PIPELINE_FORMAT_DETECTED_COUNT)
          .add(1, { format, method: detectionMethod })
        return { format, plugin }
      }
    }

    // 4. Try magic bytes (for buffers)
    if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
      const format = detectFormatFromBytes(bytes)
      if (format) {
        const plugin = this.plugins.get(format)
        if (plugin) {
          detectionMethod = 'magic'
          metrics
            .counter(SemanticMetrics.PIPELINE_FORMAT_DETECTED_COUNT)
            .add(1, { format, method: detectionMethod })
          return { format, plugin }
        }
      }
    }

    metrics
      .counter(SemanticMetrics.PIPELINE_FORMAT_DETECTED_COUNT)
      .add(1, { format: 'unknown', method: 'failed' })
    return null
  }

  /**
   * Get all registered format IDs.
   */
  getAllFormats(): FormatId[] {
    return Array.from(this.plugins.keys())
  }

  /**
   * Get all registered plugins.
   */
  getAllPlugins(): FormatPlugin[] {
    return Array.from(this.plugins.values())
  }
}

// ============================================================================
// Default Registry
// ============================================================================

let defaultRegistry: PluginRegistry | null = null

/**
 * Get the default plugin registry.
 * Creates a new instance on first call.
 */
export function getDefaultRegistry(): PluginRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PluginRegistry()
  }
  return defaultRegistry
}

/**
 * Reset the default registry to a fresh state.
 * Useful for test isolation to prevent cross-test pollution.
 */
export function resetDefaultRegistry(): void {
  defaultRegistry = null
}

/**
 * Register a plugin with the default registry.
 */
export function registerPlugin(plugin: FormatPlugin): void {
  getDefaultRegistry().register(plugin)
}

/**
 * Get a plugin from the default registry.
 */
export function getPlugin(id: FormatId): FormatPlugin | undefined {
  return getDefaultRegistry().get(id)
}

// ============================================================================
// Detection Utilities
// ============================================================================

/**
 * Get file extension from a path or URL string.
 * Returns lowercase extension with dot (e.g., ".pdf") or null.
 */
export function getExtension(path: string): string | null {
  // Handle URLs by extracting pathname
  let pathname = path
  try {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      pathname = new URL(path).pathname
    }
  } catch {
    // Not a URL, use as-is
  }

  // Remove query string and fragment
  pathname = pathname.split('?')[0].split('#')[0]

  // Get extension
  const lastDot = pathname.lastIndexOf('.')
  const lastSlash = Math.max(pathname.lastIndexOf('/'), pathname.lastIndexOf('\\'))

  if (lastDot > lastSlash && lastDot < pathname.length - 1) {
    return pathname.slice(lastDot).toLowerCase()
  }

  return null
}

/**
 * Detect format from magic bytes.
 * Returns format ID or null if unknown.
 */
export function detectFormatFromBytes(bytes: Uint8Array): FormatId | null {
  if (bytes.length < 4) {
    return null
  }

  // Check standard magic bytes first
  for (const { signature, format } of MAGIC_BYTES) {
    let match = true
    for (let i = 0; i < signature.length && i < bytes.length; i++) {
      if (bytes[i] !== signature[i]) {
        match = false
        break
      }
    }
    if (match) {
      return format
    }
  }

  // Special case: WebP detection requires checking RIFF header + WEBP marker at offset 8
  // This avoids false positives with other RIFF formats (WAV, AVI, etc.)
  if (bytes.length >= 12) {
    const hasRiffHeader = WEBP_RIFF_HEADER.every((b, i) => bytes[i] === b)
    const hasWebpMarker = WEBP_MARKER.every((b, i) => bytes[8 + i] === b)
    if (hasRiffHeader && hasWebpMarker) {
      return 'image'
    }
  }

  return null
}

/**
 * Detect format from MIME type.
 * Returns format ID or null if unknown.
 */
export function detectFormatFromMime(mimeType: string): FormatId | null {
  return MIME_TO_FORMAT[mimeType.toLowerCase()] ?? null
}

/**
 * Detect format from file extension.
 * Returns format ID or null if unknown.
 */
export function detectFormatFromExtension(ext: string): FormatId | null {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  return EXT_TO_FORMAT[normalized] ?? null
}

/**
 * Describe a document input source for error messages.
 */
export function describeSource(input: DocumentInput): string {
  if (typeof input === 'string') {
    // File path or URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
      try {
        const url = new URL(input)
        return `URL ${url.hostname}${url.pathname}`
      } catch {
        return `URL ${input.slice(0, 50)}${input.length > 50 ? '...' : ''}`
      }
    }
    if (input === '-') {
      return 'stdin'
    }
    // File path - show just the filename
    const lastSlash = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'))
    return lastSlash >= 0 ? input.slice(lastSlash + 1) : input
  }

  if (input instanceof URL) {
    return `URL ${input.hostname}${input.pathname}`
  }

  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    return `buffer (${input.length} bytes)`
  }

  return 'unknown source'
}
