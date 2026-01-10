/**
 * Tessdata directory handling for offline OCR.
 *
 * Tesseract.js downloads language data from CDN by default.
 * For fully-offline OCR, place `*.traineddata.gz` files in `tessdata/`
 * at the repo root (or specify a custom directory).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { obs } from '../observability/index.js'
import { SemanticMetrics } from '../observability/types.js'

/**
 * Get the repository root directory.
 */
function repoRoot(): string {
  // This file lives at {root}/lib/ocr/tessdata.ts
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '../..')
}

/**
 * Get the default tessdata directory ({repo}/tessdata/).
 */
export function defaultTessdataDir(): string {
  return path.join(repoRoot(), 'tessdata')
}

/**
 * Check if local language files exist for the given language(s).
 * Supports multi-language specs like "eng+jpn".
 */
export function hasLocalLangFile(tessdataDir: string, lang: string): boolean {
  const parts = lang
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.every((p) => fs.existsSync(path.join(tessdataDir, `${p}.traineddata.gz`)))
}

/**
 * Determine if offline OCR should be used.
 */
export function shouldUseOffline(tessdataDir: string, lang: string): boolean {
  const { metrics, logger } = obs('ocr.tessdata')
  const useOffline = fs.existsSync(tessdataDir) && hasLocalLangFile(tessdataDir, lang)

  metrics
    .counter(SemanticMetrics.OCR_TESSDATA_LOADS_COUNT)
    .add(1, { source: useOffline ? 'local' : 'cdn', lang })
  logger.debug({ tessdataDir, lang, useOffline }, 'Tessdata source determined')

  return useOffline
}

/**
 * Get Tesseract.js worker options for offline mode.
 */
export function getOfflineWorkerOptions(tessdataDir: string): {
  langPath: string
  cachePath: string
  gzip: boolean
} {
  return {
    langPath: tessdataDir,
    cachePath: tessdataDir,
    gzip: true,
  }
}
