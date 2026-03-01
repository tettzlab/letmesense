/**
 * Shared constants for PDF processing.
 *
 * Centralized here to avoid duplication and ensure consistency
 * between extraction, OCR, and run concatenation logic.
 */

/**
 * Separator inserted between pages within a single run.
 * Used by both digital extraction and OCR to join page text.
 */
export const DEFAULT_PAGE_SEPARATOR = '\n\n---\n\n'

/**
 * Separator inserted between runs (groups of homogeneous pages).
 * Uses `===` to visually distinguish run boundaries from page boundaries.
 */
export const DEFAULT_RUN_SEPARATOR = '\n\n===\n\n'

/**
 * Default threshold for mixed-page OCR fallback.
 *
 * For "mixed" pages (containing both text and images), if digital extraction
 * yields fewer non-whitespace characters than this threshold, fall back to OCR.
 * 50 chars filters pages with only headers, footers, or page numbers appearing
 * as text while the actual content is in scanned images.
 *
 * Override via LETMESENSE_OCR_THRESHOLD environment variable.
 */
export const DEFAULT_MIXED_FALLBACK_CHARS = process.env.LETMESENSE_OCR_THRESHOLD
  ? parseInt(process.env.LETMESENSE_OCR_THRESHOLD, 10)
  : 50

// Re-export shared timeout constants for backwards compatibility
export { DEFAULT_FETCH_TIMEOUT_MS, DEFAULT_PAGE_TIMEOUT_MS } from '../common/timeouts.js'

/**
 * Default OCR render scale factor.
 *
 * 2.5x provides a good balance between OCR accuracy and performance:
 * - Lower values (1.0-2.0): faster but may miss small text or fine details
 * - Higher values (3.0-4.0): better accuracy but significantly slower and more memory
 * - 2.5 chosen empirically for typical scanned documents at 300 DPI
 *
 * For 300 DPI scans, 2.5x yields effective 750 DPI which Tesseract handles well.
 * For lower quality scans (150 DPI), consider increasing to 3.0-4.0.
 *
 * Override via LETMESENSE_OCR_SCALE environment variable.
 */
export const DEFAULT_OCR_RENDER_SCALE = process.env.LETMESENSE_OCR_SCALE
  ? parseFloat(process.env.LETMESENSE_OCR_SCALE)
  : 2.5

/**
 * Wraps a promise with a timeout. Rejects with TimeoutError if the promise
 * doesn't resolve within the specified time.
 *
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds (0 to disable)
 * @param message - Error message for timeout
 * @returns The wrapped promise
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (timeoutMs <= 0) return promise

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout: ${message}`))
    }, timeoutMs)

    promise
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}
