/**
 * Image viewing tool implementation.
 *
 * Enables the LLM to view image files by returning base64-encoded data
 * for vision-capable models, with metadata-only fallback.
 * Optionally analyzes images using vision models to return markdown descriptions.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { LanguageModel } from 'ai'
import sharp from 'sharp'
import { obs, SemanticAttributes } from '../observability/index.js'
import { Metrics, Spans } from './signals.js'
import { analyzeImage, type VisionAnalysisError } from './vision.js'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum image file size - 20MB raw file */
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024

/** Default resize dimension */
export const DEFAULT_IMAGE_MAX_DIMENSION = 1024

/** Maximum output dimension */
export const MAX_IMAGE_OUTPUT_DIMENSION = 2048

/** Maximum base64 output size - 4MB */
export const MAX_IMAGE_OUTPUT_BYTES = 4 * 1024 * 1024

/** Default JPEG quality */
export const DEFAULT_IMAGE_QUALITY = 85

/** Image processing timeout - 10 seconds */
export const IMAGE_PROCESS_TIMEOUT_MS = 10_000

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ImageFormat = 'png' | 'jpg' | 'gif' | 'webp' | 'svg'
type ErrorCode = 'ENOENT' | 'EPERM' | 'LIMIT' | 'UNSUPPORTED' | 'PARSE' | 'UNKNOWN_FORMAT'

export interface ViewImageOptions {
  filePath: string // Display path (for result)
  maxDimension?: number
  quality?: number
  metadataOnly?: boolean
  format?: 'auto' | ImageFormat
  // Vision analysis options
  analyze?: boolean
  visionPrompt?: string
  visionModel?: LanguageModel
}

interface ImageMetadata {
  hasAlpha?: boolean
  colorSpace?: string
  orientation?: number
  exif?: Record<string, unknown>
}

interface ViewImageSuccess {
  ok: true
  filePath: string
  format: ImageFormat
  bytes: number
  width: number
  height: number
  resized: boolean
  outputWidth?: number
  outputHeight?: number
  mimeType?: string
  data?: string
  metadata?: ImageMetadata
  warnings?: string[]
  // Vision analysis fields (when analyze=true)
  visionDescription?: string
  visionModel?: string
  visionTruncated?: boolean
}

interface ViewImageError {
  ok: false
  error: string
  code?: ErrorCode | VisionAnalysisError['code']
}

export type ViewImageResult = ViewImageSuccess | ViewImageError

// ─────────────────────────────────────────────────────────────────────────────
// Format Detection
// ─────────────────────────────────────────────────────────────────────────────

const EXTENSION_TO_FORMAT: Record<string, ImageFormat> = {
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.gif': 'gif',
  '.webp': 'webp',
  '.svg': 'svg',
}

const FORMAT_TO_MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

function detectFormat(filePath: string): ImageFormat | null {
  const ext = path.extname(filePath).toLowerCase()
  return EXTENSION_TO_FORMAT[ext] ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// File Validation
// ─────────────────────────────────────────────────────────────────────────────

async function validateImageFile(
  resolvedPath: string,
): Promise<{ ok: true; bytes: number } | ViewImageError> {
  try {
    const stat = await fs.stat(resolvedPath)

    if (!stat.isFile()) {
      return { ok: false, error: 'Path is not a file', code: 'ENOENT' }
    }

    if (stat.size > MAX_IMAGE_FILE_BYTES) {
      const sizeMB = (stat.size / 1024 / 1024).toFixed(1)
      const limitMB = (MAX_IMAGE_FILE_BYTES / 1024 / 1024).toFixed(0)
      return {
        ok: false,
        error: `File too large: ${sizeMB}MB exceeds ${limitMB}MB limit`,
        code: 'LIMIT',
      }
    }

    if (stat.size === 0) {
      return { ok: false, error: 'File is empty', code: 'PARSE' }
    }

    return { ok: true, bytes: stat.size }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { ok: false, error: 'File not found', code: 'ENOENT' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, error: 'Permission denied', code: 'EPERM' }
    }
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG Handling (special case - text-based)
// ─────────────────────────────────────────────────────────────────────────────

async function processSvg(
  resolvedPath: string,
  filePath: string,
  bytes: number,
  metadataOnly: boolean,
): Promise<ViewImageResult> {
  const content = await fs.readFile(resolvedPath, 'utf8')

  // Extract viewBox or width/height for dimensions
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

  const result: ViewImageSuccess = {
    ok: true,
    filePath,
    format: 'svg',
    bytes,
    width: width || 0,
    height: height || 0,
    resized: false,
  }

  if (!metadataOnly) {
    result.mimeType = 'image/svg+xml'
    result.data = Buffer.from(content).toString('base64')
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Raster Image Processing
// ─────────────────────────────────────────────────────────────────────────────

async function processRasterImage(
  resolvedPath: string,
  filePath: string,
  bytes: number,
  format: ImageFormat,
  options: ViewImageOptions,
): Promise<ViewImageResult> {
  const maxDim = Math.min(
    options.maxDimension ?? DEFAULT_IMAGE_MAX_DIMENSION,
    MAX_IMAGE_OUTPUT_DIMENSION,
  )
  const quality = options.quality ?? DEFAULT_IMAGE_QUALITY
  const metadataOnly = options.metadataOnly ?? false

  const warnings: string[] = []

  // Read and get metadata
  let image: sharp.Sharp
  let meta: sharp.Metadata
  try {
    image = sharp(resolvedPath)
    meta = await image.metadata()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error reading image'
    return { ok: false, error: message, code: 'PARSE' }
  }

  if (!meta.width || !meta.height) {
    return { ok: false, error: 'Could not read image dimensions', code: 'PARSE' }
  }

  const originalWidth = meta.width
  const originalHeight = meta.height

  // Build result with metadata
  const result: ViewImageSuccess = {
    ok: true,
    filePath,
    format,
    bytes,
    width: originalWidth,
    height: originalHeight,
    resized: false,
    metadata: {
      hasAlpha: meta.hasAlpha,
      colorSpace: meta.space,
      orientation: meta.orientation,
    },
  }

  // Extract EXIF for JPG
  if (format === 'jpg' && meta.exif && result.metadata) {
    try {
      // sharp provides raw EXIF buffer; note its presence
      // Full EXIF parsing would require exif-reader library
      result.metadata.exif = { present: true }
    } catch {
      warnings.push('Could not parse EXIF data')
    }
  }

  if (metadataOnly) {
    if (warnings.length) result.warnings = warnings
    return result
  }

  // Determine if resize needed
  const needsResize = originalWidth > maxDim || originalHeight > maxDim

  let pipeline = image

  if (needsResize) {
    pipeline = pipeline.resize(maxDim, maxDim, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    result.resized = true
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
      // Sharp handles GIF; for animated GIFs it takes first frame by default
      outputBuffer = await pipeline.gif().toBuffer()
      break
    case 'webp':
      outputBuffer = await pipeline.webp({ quality }).toBuffer()
      break
    default:
      return { ok: false, error: `Unsupported format: ${format}`, code: 'UNSUPPORTED' }
  }

  // Check output size
  if (outputBuffer.length > MAX_IMAGE_OUTPUT_BYTES) {
    // Try reducing quality for lossy formats
    if (format === 'jpg' || format === 'webp') {
      const reducedQuality = Math.max(50, quality - 20)
      warnings.push(`Output too large; reduced quality to ${reducedQuality}`)

      if (format === 'jpg') {
        outputBuffer = await pipeline.jpeg({ quality: reducedQuality }).toBuffer()
      } else {
        outputBuffer = await pipeline.webp({ quality: reducedQuality }).toBuffer()
      }
    }

    // If still too large, error
    if (outputBuffer.length > MAX_IMAGE_OUTPUT_BYTES) {
      return {
        ok: false,
        error: `Processed image too large: ${(outputBuffer.length / 1024 / 1024).toFixed(1)}MB`,
        code: 'LIMIT',
      }
    }
  }

  // Get final dimensions after resize
  if (result.resized) {
    try {
      const outputMeta = await sharp(outputBuffer).metadata()
      result.outputWidth = outputMeta.width
      result.outputHeight = outputMeta.height
    } catch {
      warnings.push('Could not read output dimensions after resize')
    }
  }

  result.mimeType = FORMAT_TO_MIME[format]
  result.data = outputBuffer.toString('base64')

  if (warnings.length) result.warnings = warnings

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * View an image file, returning base64-encoded data for vision models.
 *
 * @param resolvedPath - Absolute path to the image file (already validated against workspace)
 * @param options - Processing options
 * @returns Image data with metadata, or error result
 */
export async function runViewImage(
  resolvedPath: string,
  options: ViewImageOptions,
): Promise<ViewImageResult> {
  const { tracer, metrics, logger } = obs('images.view')

  return tracer.startSpan(Spans.VIEW, async (span) => {
    const start = performance.now()
    span.setAttribute('filePath', options.filePath)

    // Validate file
    const validation = await validateImageFile(resolvedPath)
    if (!validation.ok) {
      span.setAttribute(SemanticAttributes.STATUS, 'error')
      span.setAttribute('errorCode', validation.code ?? 'unknown')
      metrics.counter(Metrics.LOAD_COUNT).add(1, { status: 'error' })
      return validation
    }

    const { bytes } = validation
    span.setAttribute(SemanticAttributes.BYTES, bytes)

    // Detect format
    const formatOption = options.format ?? 'auto'
    const format = formatOption === 'auto' ? detectFormat(options.filePath) : formatOption

    if (!format) {
      const ext = path.extname(options.filePath)
      span.setAttribute(SemanticAttributes.STATUS, 'error')
      span.setAttribute('errorCode', 'UNKNOWN_FORMAT')
      metrics.counter(Metrics.LOAD_COUNT).add(1, { status: 'error' })
      return {
        ok: false,
        error: `Unknown image format: ${ext || '(no extension)'}`,
        code: 'UNKNOWN_FORMAT',
      }
    }

    span.setAttribute(SemanticAttributes.FORMAT, format)

    // Process based on format with timeout
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<ViewImageError>((resolve) => {
      timer = setTimeout(() => {
        resolve({ ok: false, error: 'Image processing timed out', code: 'LIMIT' })
      }, IMAGE_PROCESS_TIMEOUT_MS)
    })

    const processPromise =
      format === 'svg'
        ? processSvg(resolvedPath, options.filePath, bytes, options.metadataOnly ?? false)
        : processRasterImage(resolvedPath, options.filePath, bytes, format, options)

    const result = await Promise.race([processPromise, timeoutPromise])
    clearTimeout(timer)

    // Record metrics
    const durationMs = performance.now() - start
    if (result.ok) {
      span.setAttribute(SemanticAttributes.STATUS, 'success')
      span.setAttribute(SemanticAttributes.WIDTH, result.width)
      span.setAttribute(SemanticAttributes.HEIGHT, result.height)
      span.setAttribute('resized', result.resized)
      metrics.counter(Metrics.LOAD_COUNT).add(1, { status: 'success', format })
      metrics.histogram(Metrics.LOAD_BYTES).record(bytes, { format })
      metrics.histogram(Metrics.PROCESS_DURATION_MS).record(durationMs, { format })
      if (result.resized) {
        metrics.counter(Metrics.RESIZE_COUNT).add(1, { format })
      }
      logger.debug(
        { format, bytes, width: result.width, height: result.height, durationMs },
        'Image processed',
      )
    } else {
      span.setAttribute(SemanticAttributes.STATUS, 'error')
      metrics.counter(Metrics.LOAD_COUNT).add(1, { status: 'error', format })
    }

    // If analyze mode and we have base64 data, run vision analysis
    if (options.analyze && result.ok && result.data && options.visionModel) {
      const visionResult = await analyzeImage({
        imageData: result.data,
        mimeType: result.mimeType ?? 'image/png',
        prompt: options.visionPrompt,
        model: options.visionModel,
      })

      if (visionResult.ok) {
        // Return vision analysis result, omitting base64 data
        return {
          ok: true,
          filePath: result.filePath,
          format: result.format,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          resized: result.resized,
          outputWidth: result.outputWidth,
          outputHeight: result.outputHeight,
          metadata: result.metadata,
          warnings: result.warnings,
          // Vision fields
          visionDescription: visionResult.description,
          visionModel: visionResult.model,
          visionTruncated: visionResult.truncated,
        }
      }
      // Vision analysis failed
      return {
        ok: false,
        error: `Vision analysis failed: ${visionResult.error}`,
        code: visionResult.code,
      }
    }

    return result
  })
}
