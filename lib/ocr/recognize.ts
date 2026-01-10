/**
 * Core OCR recognition function.
 * Takes an image buffer and returns extracted text.
 */

import type { Worker } from 'tesseract.js'

import { obs } from '../observability/index.js'
import { SemanticMetrics, SpanNames } from '../observability/types.js'
import type { OcrOptions, OcrResult, OcrResultWithOrientation } from './types.js'
import { createOcrWorker, terminateWorker } from './worker.js'

const DEFAULT_TIMEOUT_MS = 60000

/**
 * OCR an image buffer using Tesseract.js.
 * Creates a new worker for each call - suitable for one-off OCR.
 *
 * @param imageBuffer - PNG, JPEG, or other image format buffer
 * @param options - OCR options
 * @returns OCR result with text and confidence
 */
export async function recognizeImage(
  imageBuffer: Buffer | Uint8Array,
  options: OcrOptions,
): Promise<OcrResult> {
  const { tracer, metrics, logger } = obs('ocr')

  return tracer.startSpan(SpanNames.OCR_RECOGNIZE, async (span) => {
    span.setAttribute('lang', options.lang)
    span.setAttribute('imageBytes', imageBuffer.length)

    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS
    const worker = await createOcrWorker({
      lang: options.lang,
      tessdataDir: options.tessdataDir,
    })

    try {
      const result = await withTimeout(
        performRecognition(worker, imageBuffer, options),
        timeout,
        'OCR timed out',
      )

      span.setAttribute('confidence', result.confidence)
      span.setAttribute('textLength', result.text.length)
      metrics.counter(SemanticMetrics.OCR_RECOGNITIONS_COUNT).add(1, { lang: options.lang })
      metrics
        .histogram(SemanticMetrics.OCR_CONFIDENCE)
        .record(result.confidence, { lang: options.lang })
      logger.debug(
        { lang: options.lang, confidence: result.confidence, textLength: result.text.length },
        'OCR completed',
      )

      return result
    } finally {
      await terminateWorker(worker)
    }
  })
}

/**
 * OCR an image buffer using a provided worker.
 * Use this when you have a reusable worker for batch processing.
 *
 * @param worker - Tesseract.js worker
 * @param imageBuffer - PNG, JPEG, or other image format buffer
 * @param options - OCR options (lang and tessdataDir ignored since worker is provided)
 * @returns OCR result with text and confidence
 */
export async function recognizeImageWithWorker(
  worker: Worker,
  imageBuffer: Buffer | Uint8Array,
  options: Pick<OcrOptions, 'timeout' | 'detectOrientation'> = {},
): Promise<OcrResultWithOrientation> {
  const { tracer, metrics } = obs('ocr')

  return tracer.startSpan(SpanNames.OCR_RECOGNIZE_WITH_WORKER, async (span) => {
    span.setAttribute('imageBytes', imageBuffer.length)

    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS
    const result = await withTimeout(
      performRecognition(worker, imageBuffer, options),
      timeout,
      'OCR timed out',
    )

    span.setAttribute('confidence', result.confidence)
    span.setAttribute('textLength', result.text.length)
    metrics.histogram(SemanticMetrics.OCR_CONFIDENCE).record(result.confidence)

    return result
  })
}

/**
 * Internal: Perform the actual OCR recognition.
 */
async function performRecognition(
  worker: Worker,
  imageBuffer: Buffer | Uint8Array,
  options: Pick<OcrOptions, 'detectOrientation'>,
): Promise<OcrResultWithOrientation> {
  // Tesseract.js expects Buffer, convert if needed
  const buffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer)

  let orientation: number | undefined
  let script: string | undefined

  if (options.detectOrientation) {
    try {
      const detectResult = await worker.detect(buffer)
      orientation = detectResult.data?.orientation_degrees ?? undefined
      // Note: orientation_script is not part of Tesseract.js DetectData type
      script = (detectResult.data as unknown as Record<string, unknown>)?.orientation_script as
        | string
        | undefined
    } catch {
      // Detection is optional, continue without it
    }
  }

  const { data } = await worker.recognize(buffer)

  return {
    text: (data?.text ?? '').trim(),
    confidence: data?.confidence ?? 0,
    orientation,
    script,
  }
}

/**
 * Helper: Run a promise with timeout.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}
