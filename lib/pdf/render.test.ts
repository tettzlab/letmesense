import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the canvas module
const mockContext = {
  clearRect: vi.fn(),
}

const mockCanvas = {
  getContext: vi.fn(() => mockContext),
  toBuffer: vi.fn((_format: string) => Buffer.from('fake-image-data')),
}

vi.mock('@napi-rs/canvas', () => ({
  createCanvas: vi.fn(() => mockCanvas),
}))

// Mock pdfjs types
vi.mock('./pdfjsTypes.js', () => ({
  asPdfjsCanvasContext: vi.fn((ctx) => ctx),
}))

import { createCanvas } from '@napi-rs/canvas'
import { PageRenderer, renderAllPages, renderPage } from './render.js'

// Mock types for testing
interface MockPage {
  getViewport: Mock
  render: Mock
}

interface MockPdf {
  numPages: number
  getPage: Mock
}

// Create mock PDF page with proper typing
const createMockPage = (width = 612, height = 792): MockPage => ({
  getViewport: vi.fn(({ scale }: { scale: number }) => ({
    width: width * scale,
    height: height * scale,
  })),
  render: vi.fn(() => ({
    promise: Promise.resolve(),
  })),
})

// Create mock PDF document with proper typing
const createMockPdf = (numPages = 3): MockPdf => ({
  numPages,
  getPage: vi.fn(async (_pageNum: number) => createMockPage()),
})

describe('renderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanvas.toBuffer.mockReturnValue(Buffer.from('fake-image-data'))
  })

  it('renders a page with default options', async () => {
    const page = createMockPage()

    const result = await renderPage(page as unknown as PDFPageProxy)

    expect(createCanvas).toHaveBeenCalled()
    expect(page.render).toHaveBeenCalled()
    expect(result.buffer).toBeInstanceOf(Buffer)
    expect(result.format).toBe('png')
    expect(result.dataUri).toMatch(/^data:image\/png;base64,/)
  })

  it('uses custom scale', async () => {
    const page = createMockPage()

    await renderPage(page as unknown as PDFPageProxy, { scale: 3.0 })

    expect(page.getViewport).toHaveBeenCalledWith({ scale: 3.0 })
  })

  it('renders as JPEG when specified', async () => {
    const page = createMockPage()
    mockCanvas.toBuffer.mockReturnValue(Buffer.from('jpeg-data'))

    const result = await renderPage(page as unknown as PDFPageProxy, { format: 'jpeg' })

    expect(mockCanvas.toBuffer).toHaveBeenCalledWith('image/jpeg', 85)
    expect(result.format).toBe('jpeg')
    expect(result.dataUri).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('uses custom JPEG quality', async () => {
    const page = createMockPage()

    await renderPage(page as unknown as PDFPageProxy, { format: 'jpeg', quality: 95 })

    expect(mockCanvas.toBuffer).toHaveBeenCalledWith('image/jpeg', 95)
  })

  it('calculates correct dimensions', async () => {
    const page = createMockPage(800, 600)

    const result = await renderPage(page as unknown as PDFPageProxy, { scale: 2.0 })

    expect(result.width).toBe(1600) // 800 * 2
    expect(result.height).toBe(1200) // 600 * 2
  })

  it('generates valid base64 data URI', async () => {
    const page = createMockPage()

    const result = await renderPage(page as unknown as PDFPageProxy)

    expect(result.dataUri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
    // Verify we can decode the base64
    const base64 = result.dataUri.split(',')[1]
    expect(() => Buffer.from(base64, 'base64')).not.toThrow()
  })
})

describe('PageRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanvas.toBuffer.mockReturnValue(Buffer.from('fake-image-data'))
  })

  describe('init', () => {
    it('initializes with PDF document', async () => {
      const pdf = createMockPdf(3)
      const renderer = new PageRenderer()

      await renderer.init(pdf as unknown as PDFDocumentProxy)

      // Should have called getPage for each page to find max dimensions
      expect(pdf.getPage).toHaveBeenCalledTimes(3)
    })

    it('creates canvas with max dimensions', async () => {
      const pdf = createMockPdf(2)
      const renderer = new PageRenderer()

      await renderer.init(pdf as unknown as PDFDocumentProxy, 2.0)

      expect(createCanvas).toHaveBeenCalled()
    })

    it('uses custom scale', async () => {
      const pdf = createMockPdf(1)
      const renderer = new PageRenderer()

      await renderer.init(pdf as unknown as PDFDocumentProxy, 3.0)

      expect(pdf.getPage).toHaveBeenCalled()
    })
  })

  describe('renderPage', () => {
    it('renders page using pre-allocated canvas', async () => {
      const pdf = createMockPdf(1)
      const renderer = new PageRenderer()
      await renderer.init(pdf as unknown as PDFDocumentProxy)

      const page = createMockPage()
      const result = await renderer.renderPage(page as unknown as PDFPageProxy)

      expect(result.buffer).toBeInstanceOf(Buffer)
      expect(result.format).toBe('png')
    })

    it('falls back to non-optimized rendering if not initialized', async () => {
      const renderer = new PageRenderer()
      const page = createMockPage()

      // Should work even without init (fallback)
      const result = await renderer.renderPage(page as unknown as PDFPageProxy)

      expect(result.buffer).toBeInstanceOf(Buffer)
    })

    it('clears canvas before rendering', async () => {
      const pdf = createMockPdf(1)
      const renderer = new PageRenderer()
      await renderer.init(pdf as unknown as PDFDocumentProxy)

      const page = createMockPage()
      await renderer.renderPage(page as unknown as PDFPageProxy)

      expect(mockContext.clearRect).toHaveBeenCalled()
    })

    it('renders as JPEG when specified', async () => {
      const pdf = createMockPdf(1)
      const renderer = new PageRenderer()
      await renderer.init(pdf as unknown as PDFDocumentProxy)

      const page = createMockPage()
      const result = await renderer.renderPage(page as unknown as PDFPageProxy, {
        format: 'jpeg',
        quality: 90,
      })

      expect(result.format).toBe('jpeg')
      expect(mockCanvas.toBuffer).toHaveBeenCalledWith('image/jpeg', 90)
    })
  })

  describe('dispose', () => {
    it('cleans up resources', async () => {
      const pdf = createMockPdf(1)
      const renderer = new PageRenderer()
      await renderer.init(pdf as unknown as PDFDocumentProxy)

      renderer.dispose()

      // After dispose, renderPage should fall back to non-optimized
      const page = createMockPage()
      const result = await renderer.renderPage(page as unknown as PDFPageProxy)

      // Should still work (fallback)
      expect(result.buffer).toBeInstanceOf(Buffer)
    })
  })
})

describe('renderAllPages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanvas.toBuffer.mockReturnValue(Buffer.from('fake-image-data'))
  })

  it('renders all pages of a PDF', async () => {
    const pdf = createMockPdf(3)

    const pages = await renderAllPages(pdf as unknown as PDFDocumentProxy)

    expect(pages).toHaveLength(3)
    expect(pages[0]).toHaveProperty('buffer')
    expect(pages[0]).toHaveProperty('dataUri')
  })

  it('uses custom render options', async () => {
    const pdf = createMockPdf(2)

    const pages = await renderAllPages(pdf as unknown as PDFDocumentProxy, {
      scale: 3.0,
      format: 'jpeg',
    })

    expect(pages[0].format).toBe('jpeg')
  })

  it('handles single page PDF', async () => {
    const pdf = createMockPdf(1)

    const pages = await renderAllPages(pdf as unknown as PDFDocumentProxy)

    expect(pages).toHaveLength(1)
  })

  it('disposes renderer after completion', async () => {
    const pdf = createMockPdf(2)

    // This should complete without error
    const pages = await renderAllPages(pdf as unknown as PDFDocumentProxy)

    expect(pages).toHaveLength(2)
  })
})

describe('edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanvas.toBuffer.mockReturnValue(Buffer.from('fake-image-data'))
  })

  describe('renderPage edge cases', () => {
    it('handles very small page dimensions', async () => {
      const page = createMockPage(1, 1)

      const result = await renderPage(page as unknown as PDFPageProxy, { scale: 1.0 })

      expect(result.width).toBe(1)
      expect(result.height).toBe(1)
    })

    it('handles non-integer dimensions after scaling', async () => {
      const page = createMockPage(100, 100)

      // 100 * 1.5 = 150.0 (exact), but 100 * 0.33 = 33.0
      const result = await renderPage(page as unknown as PDFPageProxy, { scale: 0.33 })

      expect(result.width).toBe(Math.ceil(100 * 0.33))
      expect(result.height).toBe(Math.ceil(100 * 0.33))
    })

    it('handles high scale values', async () => {
      const page = createMockPage(100, 100)

      const result = await renderPage(page as unknown as PDFPageProxy, { scale: 10.0 })

      expect(result.width).toBe(1000)
      expect(result.height).toBe(1000)
    })

    it('handles default JPEG quality', async () => {
      const page = createMockPage()

      await renderPage(page as unknown as PDFPageProxy, { format: 'jpeg' })

      // Default quality should be 85
      expect(mockCanvas.toBuffer).toHaveBeenCalledWith('image/jpeg', 85)
    })

    it('handles minimum JPEG quality', async () => {
      const page = createMockPage()

      await renderPage(page as unknown as PDFPageProxy, { format: 'jpeg', quality: 1 })

      expect(mockCanvas.toBuffer).toHaveBeenCalledWith('image/jpeg', 1)
    })

    it('handles maximum JPEG quality', async () => {
      const page = createMockPage()

      await renderPage(page as unknown as PDFPageProxy, { format: 'jpeg', quality: 100 })

      expect(mockCanvas.toBuffer).toHaveBeenCalledWith('image/jpeg', 100)
    })
  })

  describe('PageRenderer edge cases', () => {
    it('handles PDF with varying page sizes', async () => {
      let pageIndex = 0
      const pages = [
        createMockPage(100, 100),
        createMockPage(200, 300), // Max dimensions: 200 width, 300 height
        createMockPage(50, 50),
      ]

      const pdf = {
        numPages: 3,
        getPage: vi.fn(async () => pages[pageIndex++]),
      }

      const renderer = new PageRenderer()
      await renderer.init(pdf as unknown as PDFDocumentProxy)

      // Canvas should be created at max dimensions (200 * scale, 300 * scale)
      // Default scale is 2.5 from constants, so expected: 500x750
      expect(createCanvas).toHaveBeenCalledWith(500, 750)

      renderer.dispose()
    })

    it('handles multiple renders with different options', async () => {
      const pdf = createMockPdf(1)
      const renderer = new PageRenderer()
      await renderer.init(pdf as unknown as PDFDocumentProxy)

      const page = createMockPage()

      // First render as PNG
      const pngResult = await renderer.renderPage(page as unknown as PDFPageProxy, {
        format: 'png',
      })
      expect(pngResult.format).toBe('png')

      // Second render as JPEG
      const jpegResult = await renderer.renderPage(page as unknown as PDFPageProxy, {
        format: 'jpeg',
      })
      expect(jpegResult.format).toBe('jpeg')

      renderer.dispose()
    })

    it('clears canvas between renders', async () => {
      const pdf = createMockPdf(1)
      const renderer = new PageRenderer()
      await renderer.init(pdf as unknown as PDFDocumentProxy)

      const page = createMockPage()

      // Render twice
      await renderer.renderPage(page as unknown as PDFPageProxy)
      await renderer.renderPage(page as unknown as PDFPageProxy)

      // clearRect should be called each time
      expect(mockContext.clearRect).toHaveBeenCalledTimes(2)

      renderer.dispose()
    })
  })

  describe('renderAllPages edge cases', () => {
    it('handles PDF with zero pages', async () => {
      const pdf = createMockPdf(0)

      const pages = await renderAllPages(pdf as unknown as PDFDocumentProxy)

      expect(pages).toHaveLength(0)
    })

    it('handles large PDF', async () => {
      const pdf = createMockPdf(100)

      const pages = await renderAllPages(pdf as unknown as PDFDocumentProxy)

      expect(pages).toHaveLength(100)
    })

    it('applies options to all pages', async () => {
      const pdf = createMockPdf(3)
      mockCanvas.toBuffer.mockReturnValue(Buffer.from('jpeg-data'))

      const pages = await renderAllPages(pdf as unknown as PDFDocumentProxy, {
        format: 'jpeg',
        quality: 75,
      })

      expect(pages.every((p) => p.format === 'jpeg')).toBe(true)
    })
  })
})
