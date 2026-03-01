// biome-ignore-all lint/suspicious/noExplicitAny: Test file with mocks requires any casts

// Mock the pdfjs module before importing the functions that use it
vi.mock('./pdfjs.js', () => ({
  loadPdfDocumentFromBytes: vi.fn(),
}))

// Mock tesseract.js
vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(),
}))

// Import after mocking
import { createWorker } from 'tesseract.js'
import { DEFAULT_PAGE_TIMEOUT_MS, withTimeout } from './constants.js'
import { extractFromHomogeneousPdf } from './extractText.js'
import { ocrPdfJsDocument } from './ocr.js'
import { loadPdfDocumentFromBytes } from './pdfjs.js'
import { splitIntoRuns } from './splitRuns.js'

describe('timeout utility', () => {
  test('resolves when promise completes within timeout', async () => {
    const result = await withTimeout(Promise.resolve('success'), 1000, 'Test timeout')
    expect(result).toBe('success')
  })

  test('rejects with timeout error when promise takes too long', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(() => resolve('slow'), 500))
    await expect(withTimeout(slowPromise, 50, 'Test timeout')).rejects.toThrow(
      'Timeout: Test timeout',
    )
  })

  test('passes through promise rejection', async () => {
    const failingPromise = Promise.reject(new Error('Original error'))
    await expect(withTimeout(failingPromise, 1000, 'Test timeout')).rejects.toThrow(
      'Original error',
    )
  })

  test('returns promise unchanged when timeout is 0', async () => {
    const promise = Promise.resolve('no timeout')
    const result = await withTimeout(promise, 0, 'Should not timeout')
    expect(result).toBe('no timeout')
  })

  test('returns promise unchanged when timeout is negative', async () => {
    const promise = Promise.resolve('negative timeout')
    const result = await withTimeout(promise, -1, 'Should not timeout')
    expect(result).toBe('negative timeout')
  })

  test('DEFAULT_PAGE_TIMEOUT_MS is 60 seconds', () => {
    expect(DEFAULT_PAGE_TIMEOUT_MS).toBe(60000)
  })
})

describe('resource cleanup on errors', () => {
  describe('extractFromHomogeneousPdf', () => {
    test('cleans up PDF document on processing error', async () => {
      const mockCleanup = vi.fn().mockResolvedValue(undefined)
      const mockDestroy = vi.fn().mockResolvedValue(undefined)

      vi.mocked(loadPdfDocumentFromBytes).mockResolvedValueOnce({
        numPages: 1,
        getPage: vi.fn().mockRejectedValueOnce(new Error('Page access error')),
        cleanup: mockCleanup,
        destroy: mockDestroy,
      } as any)

      await expect(extractFromHomogeneousPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow(
        'Page access error',
      )

      expect(mockCleanup).toHaveBeenCalledTimes(1)
      expect(mockDestroy).toHaveBeenCalledTimes(1)
    })

    test('cleans up PDF document on text extraction error', async () => {
      const mockCleanup = vi.fn().mockResolvedValue(undefined)
      const mockDestroy = vi.fn().mockResolvedValue(undefined)
      const mockPage = {
        getTextContent: vi.fn().mockRejectedValueOnce(new Error('Text content error')),
      }

      vi.mocked(loadPdfDocumentFromBytes).mockResolvedValueOnce({
        numPages: 1,
        getPage: vi.fn().mockResolvedValueOnce(mockPage),
        cleanup: mockCleanup,
        destroy: mockDestroy,
      } as any)

      // With graceful degradation, errors are tracked in result, not thrown
      const result = await extractFromHomogeneousPdf(new Uint8Array([1, 2, 3]), {
        kind: 'born-digital',
      })

      // Should return empty text for failed page with error tracked
      expect(result.text).toBe('')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].phase).toBe('extract')
      expect(result.errors[0].message).toContain('Text content error')
      expect(mockCleanup).toHaveBeenCalledTimes(1)
      expect(mockDestroy).toHaveBeenCalledTimes(1)
    })
  })

  describe('splitIntoRuns', () => {
    test('cleans up PDF document on page analysis error', async () => {
      const mockCleanup = vi.fn().mockResolvedValue(undefined)
      const mockDestroy = vi.fn().mockResolvedValue(undefined)

      vi.mocked(loadPdfDocumentFromBytes).mockResolvedValueOnce({
        numPages: 1,
        getPage: vi.fn().mockRejectedValueOnce(new Error('Page analysis error')),
        cleanup: mockCleanup,
        destroy: mockDestroy,
      } as any)

      // With graceful degradation, errors are stored in page.error (not logged to console)
      const result = await splitIntoRuns(new Uint8Array([1, 2, 3]), {
        includePdfBytes: false,
      })

      // Should return a result with the failed page marked as 'unknown' with error
      expect(result.pages).toHaveLength(1)
      expect(result.pages[0].kind).toBe('unknown')
      expect(result.pages[0].error).toBeDefined()
      expect(result.pages[0].error?.message).toBe('Page analysis error')
      expect(mockCleanup).toHaveBeenCalledTimes(1)
      expect(mockDestroy).toHaveBeenCalledTimes(1)
    })
  })

  describe('ocrPdfJsDocument', () => {
    test('terminates worker on recognition error', async () => {
      const mockTerminate = vi.fn().mockResolvedValue(undefined)
      const mockRecognize = vi.fn().mockRejectedValueOnce(new Error('OCR recognition error'))

      vi.mocked(createWorker).mockResolvedValueOnce({
        recognize: mockRecognize,
        detect: vi.fn(),
        terminate: mockTerminate,
      } as any)

      // Mock page returned for both pre-scan and render loops
      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      }

      const mockPdf = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      }

      // With graceful degradation, errors are tracked in result, not thrown
      const result = await ocrPdfJsDocument(mockPdf as any, { lang: 'eng' })

      // Should return empty text for failed page with error tracked
      expect(result.text).toBe('')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].phase).toBe('ocr')
      expect(result.errors[0].message).toContain('OCR recognition error')
      expect(mockTerminate).toHaveBeenCalledTimes(1)
    })

    test('terminates worker on page render error', async () => {
      const mockTerminate = vi.fn().mockResolvedValue(undefined)

      vi.mocked(createWorker).mockResolvedValueOnce({
        recognize: vi.fn(),
        detect: vi.fn(),
        terminate: mockTerminate,
      } as any)

      // Single page mock used for both pre-scan (viewport) and render (fails)
      // Using mockImplementation to create rejected promise lazily (only when render is called)
      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
        render: vi.fn().mockImplementation(() => ({
          promise: Promise.reject(new Error('Render error')),
        })),
      }

      const mockPdf = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      }

      // With graceful degradation, errors are tracked in result, not thrown
      const result = await ocrPdfJsDocument(mockPdf as any, { lang: 'eng' })

      // Should return empty text for failed page with error tracked
      expect(result.text).toBe('')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].phase).toBe('ocr')
      expect(result.errors[0].message).toContain('Render error')
      expect(mockTerminate).toHaveBeenCalledTimes(1)
    })
  })
})
