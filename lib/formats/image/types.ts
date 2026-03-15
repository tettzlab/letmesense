/**
 * Image-specific types for the unified extraction pipeline.
 * Extends pipeline core types with Image-specific attributes.
 */

import type { LoadedDocument } from '../../pipeline/plugin.js'
import type { ContentKind, DocumentUnit } from '../../pipeline/types.js'

// ============================================================================
// Image Format
// ============================================================================

/** Supported image formats */
export type ImageFormat = 'png' | 'jpg' | 'gif' | 'webp' | 'svg'

// ============================================================================
// Image Unit
// ============================================================================

/**
 * An image as a document unit.
 * Images are single-unit documents (no pages/slides).
 * Extends DocumentUnit with image-specific attributes.
 */
export interface ImageUnit extends DocumentUnit {
  /** Image width in pixels */
  width: number

  /** Image height in pixels */
  height: number

  /** File size in bytes */
  fileSize: number

  /** Image format */
  imageFormat: ImageFormat

  /** MIME type */
  mimeType: string

  /** Whether image was resized for processing */
  resized: boolean

  /** Output width after resize (if resized) */
  outputWidth?: number

  /** Output height after resize (if resized) */
  outputHeight?: number

  /** Image metadata */
  metadata?: ImageMetadata
}

/**
 * Image metadata from file.
 */
export interface ImageMetadata {
  /** Whether image has alpha channel */
  hasAlpha?: boolean

  /** Color space (sRGB, etc.) */
  colorSpace?: string

  /** EXIF orientation */
  orientation?: number

  /** EXIF data present */
  exif?: Record<string, unknown>
}

// ============================================================================
// Image Loaded Document
// ============================================================================

/**
 * A loaded image document.
 */
export interface ImageLoadedDocument extends LoadedDocument {
  /** Detected image format */
  imageFormat: ImageFormat

  /** MIME type */
  mimeType: string

  /** Original file path or URL */
  source: string

  /** Image width */
  width: number

  /** Image height */
  height: number

  /** Base64 encoded image data (after processing) */
  base64Data?: string
}

// ============================================================================
// Image Options
// ============================================================================

/**
 * Options for Image extraction.
 */
export interface ImageExtractOptions extends Record<string, unknown> {
  /** Maximum dimension for resize (default: 1024) */
  maxDimension?: number

  /** JPEG quality (0-100, default: 85) */
  quality?: number

  /** Return only metadata without base64 data */
  metadataOnly?: boolean

  /** Analyze image with vision LLM */
  analyze?: boolean

  /** Custom prompt for vision analysis */
  visionPrompt?: string

  /** Vision model specification: "provider:model" */
  visionModel?: string

  /** Fetch timeout for URL inputs (ms) */
  fetchTimeout?: number
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Map image characteristics to unified pipeline ContentKind.
 * Images are always classified as 'image-only'.
 */
export function classifyImage(): ContentKind {
  return 'image-only'
}

/**
 * Get MIME type for image format.
 */
export function getMimeType(format: ImageFormat): string {
  const mimeTypes: Record<ImageFormat, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }
  return mimeTypes[format]
}

/**
 * Detect image format from file extension.
 */
export function detectImageFormat(filePath: string): ImageFormat | null {
  // Strip query string and fragment so URLs like "img.png?id=123" resolve correctly
  const cleaned = filePath.split('?')[0].split('#')[0]
  const ext = cleaned.toLowerCase().split('.').pop()
  const formatMap: Record<string, ImageFormat> = {
    png: 'png',
    jpg: 'jpg',
    jpeg: 'jpg',
    gif: 'gif',
    webp: 'webp',
    svg: 'svg',
  }
  return formatMap[ext ?? ''] ?? null
}
