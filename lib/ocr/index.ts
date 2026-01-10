/**
 * Shared OCR module using Tesseract.js.
 *
 * Provides image buffer → text OCR functionality.
 * Supports offline mode via local tessdata files.
 *
 * @example
 * ```ts
 * import { recognizeImage } from '../lib/ocr'
 *
 * const result = await recognizeImage(pngBuffer, { lang: 'eng' })
 * console.log(result.text)
 * ```
 *
 * @example
 * ```ts
 * // Batch processing with reusable worker
 * import { createOcrWorker, recognizeImageWithWorker, terminateWorker } from '../lib/ocr'
 *
 * const worker = await createOcrWorker({ lang: 'eng' })
 * try {
 *   for (const buffer of imageBuffers) {
 *     const result = await recognizeImageWithWorker(worker, buffer)
 *     console.log(result.text)
 *   }
 * } finally {
 *   await terminateWorker(worker)
 * }
 * ```
 */

// Core recognition
export { recognizeImage, recognizeImageWithWorker } from './recognize.js'

// Tessdata utilities
export { defaultTessdataDir, hasLocalLangFile, shouldUseOffline } from './tessdata.js'
// Types
export type { OcrOptions, OcrResult, OcrResultWithOrientation } from './types.js'
// Worker management
export { type CreateWorkerOptions, createOcrWorker, terminateWorker } from './worker.js'
