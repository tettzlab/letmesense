/**
 * Convenience functions for common PDF text extraction patterns.
 *
 * These provide simpler, more discoverable APIs for specific use cases.
 */

import fs from 'node:fs/promises'
import { PdfLoadError } from './errors.js'
import type { ExtractAllOptions, ExtractAllResult, PdfInput } from './extractAll.js'
import { extractFromPdf } from './extractAll.js'

/**
 * Options for file-based extraction (excludes URL-specific options).
 */
export type FileExtractOptions = Omit<ExtractAllOptions, 'fetchTimeout' | 'fetchHeaders'>

/**
 * Options for URL-based extraction.
 */
export type UrlExtractOptions = ExtractAllOptions

/**
 * Result from batch processing multiple PDFs.
 */
export interface BatchResult {
  /** The original input (path, URL, or index for bytes) */
  input: string | number
  /** Extraction result if successful */
  result?: ExtractAllResult
  /** Error if extraction failed */
  error?: Error
}

/**
 * Options for batch processing.
 */
export interface BatchOptions extends ExtractAllOptions {
  /** Maximum concurrent extractions (default: 3) */
  concurrency?: number
  /** Continue processing even if some PDFs fail (default: true) */
  continueOnError?: boolean
  /** Called after each PDF is processed */
  onProgress?: (completed: number, total: number, input: PdfInput) => void
}

/**
 * Extract text from a PDF file.
 *
 * Convenience wrapper around `extractFromPdf` for file paths.
 * Provides better error messages for file-specific issues.
 *
 * @example
 * ```ts
 * const result = await extractTextFromFile('/path/to/document.pdf')
 * console.log(result.text)
 * ```
 */
export async function extractTextFromFile(
  filePath: string,
  options: FileExtractOptions = {},
): Promise<ExtractAllResult> {
  // Validate file exists before processing
  try {
    await fs.access(filePath)
  } catch {
    throw new PdfLoadError(`File not found: ${filePath}`)
  }

  return extractFromPdf(filePath, options)
}

/**
 * Extract text from a PDF at a URL.
 *
 * Convenience wrapper around `extractFromPdf` for URLs.
 * Provides better error messages for network-specific issues.
 *
 * @example
 * ```ts
 * const result = await extractTextFromUrl('https://example.com/document.pdf', {
 *   fetchTimeout: 60000,
 * })
 * console.log(result.text)
 * ```
 */
export async function extractTextFromUrl(
  url: string,
  options: UrlExtractOptions = {},
): Promise<ExtractAllResult> {
  // Validate URL format
  try {
    new URL(url)
  } catch {
    throw new PdfLoadError(`Invalid URL: ${url}`)
  }

  return extractFromPdf(url, options)
}

/**
 * Extract text from raw PDF bytes.
 *
 * Convenience wrapper around `extractFromPdf` for byte arrays.
 *
 * @example
 * ```ts
 * const bytes = await fs.readFile('document.pdf')
 * const result = await extractTextFromBytes(bytes)
 * console.log(result.text)
 * ```
 */
export async function extractTextFromBytes(
  bytes: Uint8Array | Buffer,
  options: FileExtractOptions = {},
): Promise<ExtractAllResult> {
  if (bytes.length === 0) {
    throw new PdfLoadError('Empty PDF bytes')
  }

  return extractFromPdf(bytes, options)
}

/**
 * Extract text from multiple PDFs with controlled concurrency.
 *
 * Processes PDFs in parallel (up to concurrency limit) and returns
 * results for all inputs, even if some fail.
 *
 * @example
 * ```ts
 * const results = await extractFromPdfBatch([
 *   '/path/to/doc1.pdf',
 *   '/path/to/doc2.pdf',
 *   'https://example.com/doc3.pdf',
 * ], {
 *   concurrency: 2,
 *   onProgress: (done, total) => console.log(`${done}/${total}`),
 * })
 *
 * for (const r of results) {
 *   if (r.error) {
 *     console.error(`Failed: ${r.input}`, r.error.message)
 *   } else {
 *     console.log(`Success: ${r.input}`, r.result?.text.slice(0, 100))
 *   }
 * }
 * ```
 */
export async function extractFromPdfBatch(
  inputs: PdfInput[],
  options: BatchOptions = {},
): Promise<BatchResult[]> {
  const { concurrency = 3, continueOnError = true, onProgress, ...extractOptions } = options

  const results: BatchResult[] = new Array(inputs.length)
  let completed = 0

  // Process in chunks of `concurrency`
  for (let i = 0; i < inputs.length; i += concurrency) {
    const chunk = inputs.slice(i, i + concurrency)
    const chunkPromises = chunk.map(async (input, chunkIdx) => {
      const globalIdx = i + chunkIdx
      const inputLabel = typeof input === 'string' ? input : globalIdx

      try {
        const result = await extractFromPdf(input, extractOptions)
        results[globalIdx] = { input: inputLabel, result }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        results[globalIdx] = { input: inputLabel, error }

        if (!continueOnError) {
          throw error
        }
      }

      completed++
      onProgress?.(completed, inputs.length, input)
    })

    await Promise.all(chunkPromises)
  }

  return results
}
