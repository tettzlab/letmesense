/**
 * Image plugin for the unified extraction pipeline.
 * Adapts existing lib/images/ code to the FormatPlugin interface.
 * Supports: PNG, JPG, GIF, WEBP, SVG
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'
import {
  DEFAULT_IMAGE_MAX_DIMENSION,
  DEFAULT_IMAGE_QUALITY,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_OUTPUT_BYTES,
  MAX_IMAGE_OUTPUT_DIMENSION,
} from '../../images/viewImage.js'
import { obs, SemanticAttributes } from '../../observability/index.js'
import type { CliOption, FormatPlugin, RenderedContent } from '../../pipeline/plugin.js'
import type { ContentKind, UnitExtractionResult } from '../../pipeline/types.js'
import { Metrics, Spans } from './signals.js'
import {
  classifyImage,
  detectImageFormat,
  getMimeType,
  type ImageExtractOptions,
  type ImageFormat,
  type ImageLoadedDocument,
  type ImageUnit,
} from './types.js'

// ============================================================================
// Constants
// ============================================================================

import { DEFAULT_FETCH_TIMEOUT_MS } from '../../common/timeouts.js'

// ============================================================================
// Image Plugin Implementation
// ============================================================================

export const imagePlugin: FormatPlugin<ImageUnit, ImageExtractOptions> = {
  // -------------------- Identity --------------------

  id: 'image',
  name: 'Image',
  extensions: [
    '.png',
    '.PNG',
    '.jpg',
    '.JPG',
    '.jpeg',
    '.JPEG',
    '.gif',
    '.GIF',
    '.webp',
    '.WEBP',
    '.svg',
    '.SVG',
  ],
  mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'],

  capabilities: {
    ocr: false, // OCR would need Tesseract integration
    vision: true, // Vision analysis via LLM is supported
    streaming: false,
    parallel: false, // Single-unit documents
    supportsRuns: false, // No runs for single images
    multiUnit: false, // Images are single-unit
  },

  // -------------------- Lifecycle --------------------

  async load(input, options = {}): Promise<ImageLoadedDocument> {
    const { tracer, metrics, logger } = obs('image.plugin')
    const { fetchTimeout = DEFAULT_FETCH_TIMEOUT_MS, maxDimension, quality } = options

    return tracer.startSpan(Spans.LOAD, async (span) => {
      let bytes: Uint8Array
      let source: string

      if (input instanceof Uint8Array) {
        bytes = input
        source = 'buffer'
        span.setAttribute(SemanticAttributes.INPUT_TYPE, 'buffer')
      } else if (Buffer.isBuffer(input)) {
        bytes = new Uint8Array(input)
        source = 'buffer'
        span.setAttribute(SemanticAttributes.INPUT_TYPE, 'buffer')
      } else if (input instanceof URL) {
        span.setAttribute(SemanticAttributes.INPUT_TYPE, 'url')
        const result = await fetchImage(input.toString(), fetchTimeout)
        bytes = result.bytes
        source = input.toString()
      } else if (typeof input === 'string') {
        if (input.startsWith('http://') || input.startsWith('https://')) {
          span.setAttribute(SemanticAttributes.INPUT_TYPE, 'url')
          const result = await fetchImage(input, fetchTimeout)
          bytes = result.bytes
          source = input
        } else {
          // File path
          span.setAttribute(SemanticAttributes.INPUT_TYPE, 'file')
          const stat = await fs.stat(input)
          if (stat.size > MAX_IMAGE_FILE_BYTES) {
            const sizeMB = (stat.size / 1024 / 1024).toFixed(1)
            const limitMB = (MAX_IMAGE_FILE_BYTES / 1024 / 1024).toFixed(0)
            throw new Error(`File too large: ${sizeMB}MB exceeds ${limitMB}MB limit`)
          }
          const buffer = await fs.readFile(input)
          bytes = new Uint8Array(buffer)
          source = input
        }
      } else {
        throw new Error('Invalid input type: expected string, Uint8Array, Buffer, or URL')
      }

      span.setAttribute(SemanticAttributes.BYTES, bytes.length)

      // Detect format
      const imageFormat = detectImageFormat(source) ?? detectFormatFromBytes(bytes)
      if (!imageFormat) {
        throw new Error(`Unknown image format for: ${source}`)
      }

      span.setAttribute('imageFormat', imageFormat)

      // Get image dimensions
      const { width, height, base64Data } = await processImage(bytes, imageFormat, {
        maxDimension,
        quality,
      })

      span.setAttribute(SemanticAttributes.WIDTH, width)
      span.setAttribute(SemanticAttributes.HEIGHT, height)
      metrics.counter(Metrics.LOAD_COUNT).add(1, { format: imageFormat })
      metrics.histogram(Metrics.LOAD_BYTES).record(bytes.length, { format: imageFormat })
      logger.debug({ imageFormat, width, height, bytes: bytes.length }, 'Image loaded')

      // Store a copy of bytes
      const storedBytes = new Uint8Array(bytes)

      return {
        bytes: storedBytes,
        format: 'image',
        imageFormat,
        mimeType: getMimeType(imageFormat),
        source,
        width,
        height,
        base64Data,
      }
    })
  },

  async parse(doc): Promise<{ units: ImageUnit[]; metadata?: Record<string, unknown> }> {
    const { tracer, metrics } = obs('image.plugin')
    const { imageFormat, mimeType, source, width, height, bytes } = doc as ImageLoadedDocument

    return tracer.startSpan(Spans.PARSE, async (span) => {
      span.setAttribute('imageFormat', imageFormat)
      span.setAttribute(SemanticAttributes.WIDTH, width)
      span.setAttribute(SemanticAttributes.HEIGHT, height)

      // Images are single-unit documents
      const unit: ImageUnit = {
        index: 0,
        label: path.basename(source),
        kind: 'image-only',
        charCount: 0,
        language: 'und',
        textSample: '',
        width,
        height,
        fileSize: bytes.length,
        imageFormat,
        mimeType,
        resized: false,
      }

      span.setAttribute(SemanticAttributes.UNIT_COUNT, 1)
      metrics.counter(Metrics.UNIT_COUNT).add(1, { format: imageFormat })

      return {
        units: [unit],
        metadata: {
          source,
          format: imageFormat,
          width,
          height,
          fileSize: bytes.length,
        },
      }
    })
  },

  async analyzeUnit(unit, doc): Promise<ImageUnit> {
    const { tracer, metrics, logger } = obs('image.plugin')
    const { imageFormat, width, height, bytes } = doc as ImageLoadedDocument

    return tracer.startSpan(Spans.ANALYZE_UNIT, async (span) => {
      span.setAttribute('imageFormat', imageFormat)
      span.setAttribute(SemanticAttributes.WIDTH, width)
      span.setAttribute(SemanticAttributes.HEIGHT, height)

      // Get additional metadata using sharp (for raster images)
      let metadata: ImageUnit['metadata']

      if (imageFormat !== 'svg') {
        try {
          const meta = await sharp(Buffer.from(bytes)).metadata()
          metadata = {
            hasAlpha: meta.hasAlpha,
            colorSpace: meta.space,
            orientation: meta.orientation,
          }

          if (imageFormat === 'jpg' && meta.exif) {
            metadata.exif = { present: true }
          }

          span.setAttribute('hasAlpha', meta.hasAlpha ?? false)
          span.setAttribute('colorSpace', meta.space ?? 'unknown')
        } catch (err) {
          // Metadata extraction is optional — log at warn so failures are visible
          logger.warn({ err, imageFormat }, 'Failed to extract image metadata via sharp')
        }
      }

      const kind = classifyImage()
      span.setAttribute('kind', kind)
      metrics.counter(Metrics.ANALYZE_UNIT_COUNT).add(1, { format: imageFormat })

      return {
        ...unit,
        width,
        height,
        kind,
        metadata,
      }
    })
  },

  classifyUnit(): ContentKind {
    // Images are always image-only
    return 'image-only'
  },

  // No buildRunKey - images don't support runs

  async extractUnit(_unit, doc): Promise<UnitExtractionResult> {
    const { tracer, metrics } = obs('image.plugin')
    // Images don't have extractable text without vision/OCR
    // Return a placeholder indicating image content
    const { width, height, imageFormat, source } = doc as ImageLoadedDocument

    return tracer.startSpan(Spans.EXTRACT_UNIT, async (span) => {
      span.setAttribute('imageFormat', imageFormat)
      span.setAttribute(SemanticAttributes.WIDTH, width)
      span.setAttribute(SemanticAttributes.HEIGHT, height)

      const description = `[Image: ${path.basename(source)} (${width}x${height} ${imageFormat.toUpperCase()})]`

      span.setAttribute(SemanticAttributes.CHAR_COUNT, 0)
      span.setAttribute(SemanticAttributes.METHOD, 'placeholder')
      metrics.counter(Metrics.EXTRACT_UNIT_COUNT).add(1, { format: imageFormat })

      return {
        text: description,
        charCount: 0,
        extraction: {
          method: 'digital',
          reliability: 'low', // No actual text extraction
        },
      }
    })
  },

  async renderUnit(_unit, doc, options = {}): Promise<RenderedContent> {
    const { tracer, metrics } = obs('image.plugin')
    const { bytes, imageFormat, width, height } = doc as ImageLoadedDocument
    const { scale = 1 } = options

    return tracer.startSpan(Spans.RENDER_UNIT, async (span) => {
      span.setAttribute('imageFormat', imageFormat)
      span.setAttribute(SemanticAttributes.SCALE, scale)
      span.setAttribute('originalWidth', width)
      span.setAttribute('originalHeight', height)

      // For images, return the processed base64 data
      const maxDimension = Math.round(Math.max(width, height) * scale)
      const { base64Data, outputWidth, outputHeight } = await processImage(bytes, imageFormat, {
        maxDimension,
      })

      const finalWidth = outputWidth ?? width
      const finalHeight = outputHeight ?? height
      span.setAttribute('outputWidth', finalWidth)
      span.setAttribute('outputHeight', finalHeight)
      metrics.counter(Metrics.RENDER_UNIT_COUNT).add(1, { format: imageFormat })

      return {
        base64: base64Data,
        mimeType: getMimeType(imageFormat) as 'image/png' | 'image/jpeg',
        width: finalWidth,
        height: finalHeight,
      }
    })
  },

  async cleanup(): Promise<void> {
    // No cleanup needed for images
  },

  getCliOptions(): CliOption[] {
    return [
      {
        flags: '--max-dimension <pixels>',
        description: 'Maximum dimension for resize',
        defaultValue: DEFAULT_IMAGE_MAX_DIMENSION,
      },
      {
        flags: '--quality <0-100>',
        description: 'JPEG/WebP quality',
        defaultValue: DEFAULT_IMAGE_QUALITY,
      },
      {
        flags: '--metadata-only',
        description: 'Return only metadata without image data',
        defaultValue: false,
      },
      {
        flags: '--analyze',
        description: 'Analyze image with vision LLM',
        defaultValue: false,
      },
      {
        flags: '--vision-model <spec>',
        description: 'Vision model: "provider:model"',
      },
    ]
  },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fetch image from URL.
 */
async function fetchImage(url: string, timeout: number): Promise<{ bytes: Uint8Array }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'letmesense/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    if (bytes.length > MAX_IMAGE_FILE_BYTES) {
      const sizeMB = (bytes.length / 1024 / 1024).toFixed(1)
      const limitMB = (MAX_IMAGE_FILE_BYTES / 1024 / 1024).toFixed(0)
      throw new Error(`Image too large: ${sizeMB}MB exceeds ${limitMB}MB limit`)
    }

    return { bytes }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Detect image format from bytes (magic bytes).
 */
function detectFormatFromBytes(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 4) return null

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png'
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg'
  }

  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'gif'
  }

  // WebP: 52 49 46 46 ... 57 45 42 50
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp'
  }

  // SVG: Check for XML/SVG content
  const textStart = new TextDecoder().decode(bytes.slice(0, 100))
  if (textStart.includes('<svg') || textStart.includes('<?xml')) {
    return 'svg'
  }

  return null
}

/**
 * Process image: resize if needed and return base64 data.
 */
async function processImage(
  bytes: Uint8Array,
  format: ImageFormat,
  options: { maxDimension?: number; quality?: number } = {},
): Promise<{
  width: number
  height: number
  base64Data: string
  outputWidth?: number
  outputHeight?: number
}> {
  const maxDim = Math.min(
    options.maxDimension ?? DEFAULT_IMAGE_MAX_DIMENSION,
    MAX_IMAGE_OUTPUT_DIMENSION,
  )
  const quality = options.quality ?? DEFAULT_IMAGE_QUALITY

  // Handle SVG specially (text-based)
  if (format === 'svg') {
    const content = new TextDecoder().decode(bytes)

    // Extract dimensions from viewBox or width/height
    const viewBoxMatch = content.match(/viewBox=["']([^"']+)["']/)
    const widthMatch = content.match(/width=["'](\d+)/)
    const heightMatch = content.match(/height=["'](\d+)/)

    let width = 0
    let height = 0

    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].split(/\s+/)
      if (parts.length >= 4) {
        width = Math.round(Number.parseFloat(parts[2]) || 0)
        height = Math.round(Number.parseFloat(parts[3]) || 0)
      }
    }

    if (!width && widthMatch) width = Number.parseInt(widthMatch[1], 10)
    if (!height && heightMatch) height = Number.parseInt(heightMatch[1], 10)

    return {
      width: width || 0,
      height: height || 0,
      base64Data: Buffer.from(content).toString('base64'),
    }
  }

  // Process raster image with sharp
  const image = sharp(Buffer.from(bytes))
  const meta = await image.metadata()

  if (!meta.width || !meta.height) {
    throw new Error('Could not read image dimensions')
  }

  const originalWidth = meta.width
  const originalHeight = meta.height
  const needsResize = originalWidth > maxDim || originalHeight > maxDim

  let pipeline = image
  let outputWidth: number | undefined
  let outputHeight: number | undefined

  if (needsResize) {
    pipeline = pipeline.resize(maxDim, maxDim, {
      fit: 'inside',
      withoutEnlargement: true,
    })

    // Calculate output dimensions
    const scale = Math.min(maxDim / originalWidth, maxDim / originalHeight)
    outputWidth = Math.round(originalWidth * scale)
    outputHeight = Math.round(originalHeight * scale)
  }

  // Convert to output format
  let outputBuffer: Buffer

  switch (format) {
    case 'png':
      outputBuffer = await pipeline.png().toBuffer()
      break
    case 'jpg':
      outputBuffer = await pipeline.jpeg({ quality }).toBuffer()
      break
    case 'gif':
      outputBuffer = await pipeline.gif().toBuffer()
      break
    case 'webp':
      outputBuffer = await pipeline.webp({ quality }).toBuffer()
      break
    default:
      throw new Error(`Unsupported format: ${format}`)
  }

  // Check output size and reduce quality if needed
  if (outputBuffer.length > MAX_IMAGE_OUTPUT_BYTES) {
    if (format === 'jpg' || format === 'webp') {
      const reducedQuality = Math.max(50, quality - 20)
      if (format === 'jpg') {
        outputBuffer = await pipeline.jpeg({ quality: reducedQuality }).toBuffer()
      } else {
        outputBuffer = await pipeline.webp({ quality: reducedQuality }).toBuffer()
      }
    }

    if (outputBuffer.length > MAX_IMAGE_OUTPUT_BYTES) {
      throw new Error(
        `Processed image too large: ${(outputBuffer.length / 1024 / 1024).toFixed(1)}MB`,
      )
    }
  }

  return {
    width: originalWidth,
    height: originalHeight,
    base64Data: outputBuffer.toString('base64'),
    outputWidth,
    outputHeight,
  }
}
