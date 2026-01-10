import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  extractFromPdfBatch,
  extractTextFromBytes,
  extractTextFromFile,
  extractTextFromUrl,
} from './convenience.js'
import { PdfExtractionError } from './errors.js'

const SAMPLES = {
  bornDigital: path.resolve('samples/born-digital.pdf'),
  scannedImage: path.resolve('samples/scanned-image.pdf'),
}

describe('extractTextFromFile', () => {
  test('extracts text from valid PDF file', async () => {
    const result = await extractTextFromFile(SAMPLES.bornDigital)
    expect(result.text).toBeTruthy()
    expect(result.text.length).toBeGreaterThan(0)
  })

  test('throws PdfExtractionError for non-existent file', async () => {
    await expect(extractTextFromFile('/non/existent/file.pdf')).rejects.toThrow(PdfExtractionError)
    await expect(extractTextFromFile('/non/existent/file.pdf')).rejects.toThrow('File not found')
  })

  test('passes options through to extractFromPdf', async () => {
    const result = await extractTextFromFile(SAMPLES.bornDigital, {
      includeMetadata: true,
    })
    expect(result.metadata).toBeDefined()
    expect(result.metadata?.source).toBe('file')
  })
})

describe('extractTextFromUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('extracts text from valid URL', async () => {
    const mockBytes = new Uint8Array(await fs.readFile(SAMPLES.bornDigital))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: () => Promise.resolve(mockBytes.buffer),
    } as Response)

    const result = await extractTextFromUrl('https://example.com/test.pdf')
    expect(result.text).toBeTruthy()
  })

  test('throws PdfExtractionError for invalid URL format', async () => {
    await expect(extractTextFromUrl('not-a-valid-url')).rejects.toThrow(PdfExtractionError)
    await expect(extractTextFromUrl('not-a-valid-url')).rejects.toThrow('Invalid URL')
  })

  test('passes options through to extractFromPdf', async () => {
    const mockBytes = new Uint8Array(await fs.readFile(SAMPLES.bornDigital))
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: () => Promise.resolve(mockBytes.buffer),
    } as Response)

    const result = await extractTextFromUrl('https://example.com/test.pdf', {
      includeMetadata: true,
    })
    expect(result.metadata?.source).toBe('url')
  })
})

describe('extractTextFromBytes', () => {
  test('extracts text from Uint8Array', async () => {
    const bytes = new Uint8Array(await fs.readFile(SAMPLES.bornDigital))
    const result = await extractTextFromBytes(bytes)
    expect(result.text).toBeTruthy()
  })

  test('extracts text from Buffer', async () => {
    const buffer = await fs.readFile(SAMPLES.bornDigital)
    const result = await extractTextFromBytes(buffer)
    expect(result.text).toBeTruthy()
  })

  test('throws PdfExtractionError for empty bytes', async () => {
    await expect(extractTextFromBytes(new Uint8Array([]))).rejects.toThrow(PdfExtractionError)
    await expect(extractTextFromBytes(new Uint8Array([]))).rejects.toThrow('Empty PDF bytes')
  })

  test('passes options through to extractFromPdf', async () => {
    const bytes = new Uint8Array(await fs.readFile(SAMPLES.bornDigital))
    const result = await extractTextFromBytes(bytes, {
      includeMetadata: true,
    })
    expect(result.metadata?.source).toBe('bytes')
  })
})

describe('extractFromPdfBatch', () => {
  test('processes multiple files', async () => {
    const results = await extractFromPdfBatch([SAMPLES.bornDigital, SAMPLES.bornDigital])

    expect(results).toHaveLength(2)
    expect(results[0].result?.text).toBeTruthy()
    expect(results[1].result?.text).toBeTruthy()
    expect(results[0].error).toBeUndefined()
    expect(results[1].error).toBeUndefined()
  })

  test('handles mixed success and failure', async () => {
    const results = await extractFromPdfBatch([
      SAMPLES.bornDigital,
      '/non/existent/file.pdf',
      SAMPLES.bornDigital,
    ])

    expect(results).toHaveLength(3)
    expect(results[0].result?.text).toBeTruthy()
    expect(results[0].error).toBeUndefined()
    expect(results[1].result).toBeUndefined()
    expect(results[1].error).toBeDefined()
    expect(results[2].result?.text).toBeTruthy()
    expect(results[2].error).toBeUndefined()
  })

  test('respects concurrency limit', async () => {
    let maxConcurrent = 0
    let currentConcurrent = 0

    const originalReadFile = fs.readFile
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      currentConcurrent++
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
      const result = await originalReadFile.apply(fs, args as Parameters<typeof originalReadFile>)
      await new Promise((r) => setTimeout(r, 50)) // Small delay to test concurrency
      currentConcurrent--
      return result
    })

    await extractFromPdfBatch(
      [SAMPLES.bornDigital, SAMPLES.bornDigital, SAMPLES.bornDigital, SAMPLES.bornDigital],
      { concurrency: 2 },
    )

    // With concurrency 2, we shouldn't see more than 2 concurrent operations
    expect(maxConcurrent).toBeLessThanOrEqual(2)
    vi.restoreAllMocks()
  })

  test('calls onProgress callback', async () => {
    const progressCalls: Array<{ completed: number; total: number }> = []

    await extractFromPdfBatch([SAMPLES.bornDigital, SAMPLES.bornDigital], {
      onProgress: (completed, total) => {
        progressCalls.push({ completed, total })
      },
    })

    expect(progressCalls).toHaveLength(2)
    expect(progressCalls[0]).toEqual({ completed: 1, total: 2 })
    expect(progressCalls[1]).toEqual({ completed: 2, total: 2 })
  })

  test('throws on first error when continueOnError is false', async () => {
    await expect(
      extractFromPdfBatch(['/non/existent/file.pdf', SAMPLES.bornDigital], {
        continueOnError: false,
      }),
    ).rejects.toThrow()
  })

  test('defaults to continueOnError: true', async () => {
    const results = await extractFromPdfBatch(['/non/existent/file.pdf', SAMPLES.bornDigital])

    expect(results).toHaveLength(2)
    expect(results[0].error).toBeDefined()
    expect(results[1].result?.text).toBeTruthy()
  })

  test('handles empty input array', async () => {
    const results = await extractFromPdfBatch([])
    expect(results).toEqual([])
  })

  test('includes input identifier in results', async () => {
    const results = await extractFromPdfBatch([SAMPLES.bornDigital])
    expect(results[0].input).toBe(SAMPLES.bornDigital)
  })

  test('uses index for bytes input', async () => {
    const bytes = new Uint8Array(await fs.readFile(SAMPLES.bornDigital))
    const results = await extractFromPdfBatch([bytes])
    expect(results[0].input).toBe(0)
  })
})
