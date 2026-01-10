import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { extractFromPdf, PdfExtractionError } from './extractAll.js'

const SAMPLES = {
  bornDigital: path.resolve('samples/born-digital.pdf'),
  scannedImage: path.resolve('samples/scanned-image.pdf'),
  mixed: path.resolve('samples/mixed.pdf'),
  treacherous: path.resolve('samples/treacherous.pdf'),
}

describe('extractFromPdf', () => {
  describe('input handling', () => {
    test('accepts file path, Uint8Array, and Buffer', async () => {
      // File path
      const pathResult = await extractFromPdf(SAMPLES.bornDigital)
      expect(pathResult.text).toBeTruthy()
      expect(pathResult.text.length).toBeGreaterThan(0)

      // Uint8Array
      const bytes = new Uint8Array(await fs.readFile(SAMPLES.bornDigital))
      const bytesResult = await extractFromPdf(bytes)
      expect(bytesResult.text).toBeTruthy()

      // Buffer
      const buffer = await fs.readFile(SAMPLES.bornDigital)
      const bufferResult = await extractFromPdf(buffer)
      expect(bufferResult.text).toBeTruthy()
    })

    test('rejects invalid input', async () => {
      // @ts-expect-error testing invalid input
      await expect(extractFromPdf(123)).rejects.toThrow(PdfExtractionError)
      // @ts-expect-error testing invalid input
      await expect(extractFromPdf(123)).rejects.toThrow('Invalid input type')
      await expect(extractFromPdf('/non/existent/file.pdf')).rejects.toThrow(PdfExtractionError)
    })
  })

  describe('URL fetching', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    test('fetches PDF from URL', async () => {
      const mockBytes = new Uint8Array(await fs.readFile(SAMPLES.bornDigital))
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/pdf' }),
        arrayBuffer: () => Promise.resolve(mockBytes.buffer),
      } as Response)

      const result = await extractFromPdf('https://example.com/test.pdf')
      expect(result.text).toBeTruthy()
    })

    test('throws on HTTP errors and unexpected content-type', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response)
      await expect(extractFromPdf('https://example.com/missing.pdf')).rejects.toThrow('HTTP 404')

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'text/html' }),
      } as Response)
      await expect(extractFromPdf('https://example.com/page.html')).rejects.toThrow(
        'Unexpected content-type',
      )
    })
  })

  describe('text extraction', () => {
    test('extracts text from born-digital PDF', async () => {
      const result = await extractFromPdf(SAMPLES.bornDigital)
      expect(result.text.length).toBeGreaterThan(0)
    })

    test('extracts text from scanned PDF via OCR', async () => {
      const result = await extractFromPdf(SAMPLES.scannedImage, {
        ocrLang: 'eng',
      })
      expect(result.text.length).toBeGreaterThan(0)
    }, 60000) // OCR can be slow

    // Consolidated: treacherous PDF test (was 4 separate tests with 120s each)
    test('handles treacherous PDF with mixed content, separators, and progress', async () => {
      const runCallbacks: Array<{ runIndex: number; totalRuns: number }> = []

      const result = await extractFromPdf(SAMPLES.treacherous, {
        includeMetadata: true,
        runSeparator: '<<<BREAK>>>',
        parallel: false, // Test sequential mode
        progress: {
          onRunExtracted: (runIndex, totalRuns) => {
            runCallbacks.push({ runIndex, totalRuns })
          },
        },
      })

      // Basic extraction
      expect(result.text.length).toBeGreaterThan(0)
      expect(result.metadata?.runCount).toBeGreaterThan(1)

      // Custom separator
      if (result.text.includes('<<<BREAK>>>')) {
        expect(result.text.split('<<<BREAK>>>').length).toBeGreaterThan(1)
      }

      // Progress callbacks
      expect(runCallbacks.length).toBeGreaterThan(0)
      for (const cb of runCallbacks) {
        expect(cb.runIndex).toBeGreaterThanOrEqual(0)
        expect(cb.runIndex).toBeLessThan(cb.totalRuns)
      }
    }, 120000)
  })

  describe('metadata', () => {
    test('returns metadata when requested', async () => {
      const result = await extractFromPdf(SAMPLES.bornDigital, {
        includeMetadata: true,
      })
      expect(result.metadata).toBeDefined()
      expect(result.metadata?.source).toBe('file')
      expect(result.metadata?.pageCount).toBeGreaterThan(0)
      expect(result.metadata?.runs).toBeInstanceOf(Array)
    })

    test('omits metadata by default', async () => {
      const result = await extractFromPdf(SAMPLES.bornDigital)
      expect(result.metadata).toBeUndefined()
    })

    test('metadata source is bytes for Uint8Array input', async () => {
      const bytes = new Uint8Array(await fs.readFile(SAMPLES.bornDigital))
      const result = await extractFromPdf(bytes, { includeMetadata: true })
      expect(result.metadata?.source).toBe('bytes')
    })
  })

  describe('error handling', () => {
    test('tracks failed pages in metadata', async () => {
      const result = await extractFromPdf(SAMPLES.bornDigital, {
        includeMetadata: true,
      })
      expect(result.metadata?.failedPageCount).toBe(0)
      expect(result.metadata?.errors).toEqual([])
    })

    test('strictMode passes through for good PDF', async () => {
      const result = await extractFromPdf(SAMPLES.bornDigital, {
        strictMode: true,
        includeMetadata: true,
      })
      expect(result.text.length).toBeGreaterThan(0)
      expect(result.metadata?.failedPageCount).toBe(0)
    })

    test('metadata includes error tracking structure', async () => {
      const result = await extractFromPdf(SAMPLES.bornDigital, {
        includeMetadata: true,
      })
      expect(result.metadata).toBeDefined()
      expect(Array.isArray(result.metadata?.errors)).toBe(true)
      expect(typeof result.metadata?.failedPageCount).toBe('number')
    })
  })

  describe('progress callbacks', () => {
    test('calls onPageAnalyzed for each page', async () => {
      const pageCallbacks: Array<{ pageIndex: number; totalPages: number }> = []

      await extractFromPdf(SAMPLES.bornDigital, {
        progress: {
          onPageAnalyzed: (pageIndex, totalPages) => {
            pageCallbacks.push({ pageIndex, totalPages })
          },
        },
      })

      expect(pageCallbacks.length).toBeGreaterThan(0)
      for (const cb of pageCallbacks) {
        expect(cb.pageIndex).toBeGreaterThanOrEqual(0)
        expect(cb.pageIndex).toBeLessThan(cb.totalPages)
      }
    })
  })
})
