/**
 * Tesseract.js worker management.
 */

import { createWorker, type Worker } from 'tesseract.js'

import { obs } from '../observability/index.js'
import { Metrics, Spans } from './signals.js'
import { defaultTessdataDir, getOfflineWorkerOptions, shouldUseOffline } from './tessdata.js'

/**
 * Options for creating an OCR worker.
 */
export interface CreateWorkerOptions {
  /** OCR language(s): "eng" or "eng+jpn" */
  lang: string

  /** Directory containing .traineddata.gz files for offline OCR */
  tessdataDir?: string
}

/**
 * Create a Tesseract.js worker.
 * Automatically uses offline mode if tessdata files are available.
 */
export async function createOcrWorker(options: CreateWorkerOptions): Promise<Worker> {
  const { tracer, metrics, logger } = obs('ocr.worker')

  return tracer.startSpan(Spans.WORKER_CREATE, async (span) => {
    span.setAttribute('lang', options.lang)

    const tessdataDir = options.tessdataDir ?? defaultTessdataDir()
    const useOffline = shouldUseOffline(tessdataDir, options.lang)

    span.setAttribute('useOffline', useOffline)

    const worker = await createWorker(
      options.lang,
      1, // OEM_LSTM_ONLY (default, best accuracy)
      useOffline ? getOfflineWorkerOptions(tessdataDir) : undefined,
    )

    metrics
      .counter(Metrics.WORKER_CREATED_COUNT)
      .add(1, { lang: options.lang, offline: String(useOffline) })
    logger.debug({ lang: options.lang, useOffline }, 'OCR worker created')

    return worker
  })
}

/**
 * Terminate a worker safely.
 */
export async function terminateWorker(worker: Worker): Promise<void> {
  const { metrics } = obs('ocr.worker')

  try {
    await worker.terminate()
    metrics.counter(Metrics.WORKER_TERMINATED_COUNT).add(1)
  } catch {
    // Ignore termination errors
  }
}
