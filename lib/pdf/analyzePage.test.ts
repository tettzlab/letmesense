import type { PDFPageProxy } from './pdfjs.js'

// Mock dependencies before importing the module under test
vi.mock('./classify.js', () => ({
  classifyPageKind: vi.fn(() => 'born-digital'),
}))

vi.mock('./imageCoverage.js', () => ({
  estimateImageCoverageFromPage: vi.fn(() =>
    Promise.resolve({
      pageAreaPt2: 100000,
      maxImageCoverageRatio: 0,
      totalImageCoverageRatio: 0,
      largeImageCount: 0,
      images: [],
    }),
  ),
}))

vi.mock('./pdfjsTypes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdfjsTypes.js')>()
  return {
    ...actual,
    getPageTextContent: vi.fn(() => Promise.resolve({ items: [] })),
  }
})

vi.mock('franc', () => ({
  franc: vi.fn(() => 'eng'),
}))

// Import after mocks are set up
import { franc } from 'franc'
import { analyzePage } from './analyzePage.js'
import { classifyPageKind } from './classify.js'
import { estimateImageCoverageFromPage } from './imageCoverage.js'
import { getPageTextContent } from './pdfjsTypes.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('analyzePage', () => {
  // Mock page factory
  const createMockPage = (overrides: Partial<PDFPageProxy> = {}): PDFPageProxy =>
    ({
      rotate: 0,
      userUnit: 1,
      view: [0, 0, 612, 792], // US Letter
      getViewport: vi.fn().mockReturnValue({ width: 612, height: 792 }),
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      ...overrides,
    }) as unknown as PDFPageProxy

  describe('geometry extraction', () => {
    it('extracts portrait orientation for tall pages', async () => {
      const page = createMockPage({
        view: [0, 0, 612, 792],
        getViewport: vi.fn().mockReturnValue({ width: 612, height: 792 }),
      })

      const result = await analyzePage(page, 0)
      expect(result.orientation).toBe('portrait')
    })

    it('extracts landscape orientation for wide pages', async () => {
      const page = createMockPage({
        view: [0, 0, 792, 612],
        getViewport: vi.fn().mockReturnValue({ width: 792, height: 612 }),
      })

      const result = await analyzePage(page, 0)
      expect(result.orientation).toBe('landscape')
    })

    it('handles rotation values', async () => {
      const page = createMockPage({ rotate: 90 })
      const result = await analyzePage(page, 0)
      expect(result.rotationDeg).toBe(90)
    })

    it('handles userUnit scaling', async () => {
      const page = createMockPage({
        userUnit: 2,
        view: [0, 0, 612, 792],
      })
      const result = await analyzePage(page, 0)
      expect(result.widthPt).toBe(1224) // 612 * 2
      expect(result.heightPt).toBe(1584) // 792 * 2
    })

    it('normalizes paper key to shortSide×longSide', async () => {
      const page = createMockPage({
        view: [0, 0, 792, 612], // landscape
      })
      const result = await analyzePage(page, 0)
      // paperKey should be short×long regardless of orientation
      expect(result.paperKey).toBe('612x792')
    })

    it('handles missing view array', async () => {
      const page = createMockPage({ view: undefined as unknown as number[] })
      const result = await analyzePage(page, 0)
      expect(result.widthPt).toBe(0)
      expect(result.heightPt).toBe(0)
    })

    it('handles non-numeric rotate', async () => {
      const page = createMockPage({ rotate: undefined as unknown as number })
      const result = await analyzePage(page, 0)
      expect(result.rotationDeg).toBe(0)
    })

    it('handles non-numeric userUnit', async () => {
      const page = createMockPage({ userUnit: undefined as unknown as number })
      const result = await analyzePage(page, 0)
      // Should use default of 1
      expect(result.widthPt).toBe(612)
    })
  })

  describe('text signal analysis', () => {
    it('counts non-whitespace characters', async () => {
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: 'Hello World' }],
      })
      const page = createMockPage()
      const result = await analyzePage(page, 0)
      expect(result.charCount).toBe(10) // "HelloWorld" without spaces
    })

    it('creates text sample', async () => {
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: 'This is sample text' }],
      })
      const page = createMockPage()
      const result = await analyzePage(page, 0)
      expect(result.textSample).toBe('This is sample text')
    })

    it('truncates text sample at maxTextSampleChars', async () => {
      const longText = 'x'.repeat(500)
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: longText }],
      })
      const page = createMockPage()
      const result = await analyzePage(page, 0)
      expect(result.textSample.length).toBe(400) // default maxTextSampleChars
    })

    it('handles empty text', async () => {
      vi.mocked(getPageTextContent).mockResolvedValueOnce({ items: [] })
      const page = createMockPage()
      const result = await analyzePage(page, 0)
      expect(result.charCount).toBe(0)
      expect(result.textSample).toBe('')
    })

    it('handles whitespace-only text', async () => {
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: '   \n\t  ' }],
      })
      const page = createMockPage()
      const result = await analyzePage(page, 0)
      expect(result.charCount).toBe(0)
    })
  })

  describe('language detection', () => {
    it('calls franc when charCount >= minCharsForLangDetect', async () => {
      const text = 'x'.repeat(100) // 100 chars > 80 default
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: text }],
      })
      vi.mocked(franc).mockReturnValue('deu')

      const page = createMockPage()
      const result = await analyzePage(page, 0)

      expect(franc).toHaveBeenCalled()
      expect(result.language).toBe('deu')
    })

    it('skips franc when charCount < minCharsForLangDetect', async () => {
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: 'short' }],
      })

      const page = createMockPage()
      const result = await analyzePage(page, 0)

      expect(franc).not.toHaveBeenCalled()
      expect(result.language).toBe('und')
    })

    it('returns "und" when franc returns null', async () => {
      const text = 'x'.repeat(100)
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: text }],
      })
      vi.mocked(franc).mockReturnValue(null as unknown as string)

      const page = createMockPage()
      const result = await analyzePage(page, 0)

      expect(result.language).toBe('und')
    })

    it('respects custom minCharsForLangDetect', async () => {
      const text = 'x'.repeat(50)
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: text }],
      })

      const page = createMockPage()
      // 50 chars < 80 default, so franc not called
      await analyzePage(page, 0)
      expect(franc).not.toHaveBeenCalled()

      vi.clearAllMocks()
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: text }],
      })
      // With custom threshold of 40, franc should be called
      await analyzePage(page, 0, { minCharsForLangDetect: 40 })
      expect(franc).toHaveBeenCalled()
    })
  })

  describe('classification', () => {
    it('passes charCount and coverage to classifyPageKind', async () => {
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: 'Some text here' }],
      })
      vi.mocked(estimateImageCoverageFromPage).mockResolvedValueOnce({
        pageAreaPt2: 100000,
        maxImageCoverageRatio: 0.5,
        totalImageCoverageRatio: 0.4,
        largeImageCount: 2,
        images: [],
      })

      const page = createMockPage()
      await analyzePage(page, 0)

      expect(classifyPageKind).toHaveBeenCalledWith(
        12, // "Sometexthere" - 12 non-whitespace chars
        expect.objectContaining({
          maxImageCoverageRatio: 0.5,
          totalImageCoverageRatio: 0.4,
          largeImageCount: 2,
        }),
        expect.any(Object),
      )
    })

    it('includes kind in output', async () => {
      vi.mocked(classifyPageKind).mockReturnValueOnce('scanned-image')
      const page = createMockPage()
      const result = await analyzePage(page, 0)
      expect(result.kind).toBe('scanned-image')
    })
  })

  describe('output structure', () => {
    it('returns complete PageAttributes', async () => {
      const page = createMockPage()
      const result = await analyzePage(page, 0)

      expect(result).toMatchObject({
        pageIndex: expect.any(Number),
        kind: expect.any(String),
        rotationDeg: expect.any(Number),
        widthPt: expect.any(Number),
        heightPt: expect.any(Number),
        paperKey: expect.any(String),
        orientation: expect.any(String),
        charCount: expect.any(Number),
        textSample: expect.any(String),
        imageOpCount: expect.any(Number),
        language: expect.any(String),
      })
    })

    it('preserves pageIndex', async () => {
      const page = createMockPage()
      const result = await analyzePage(page, 42)
      expect(result.pageIndex).toBe(42)
    })

    it('includes image coverage stats', async () => {
      vi.mocked(estimateImageCoverageFromPage).mockResolvedValueOnce({
        pageAreaPt2: 100000,
        maxImageCoverageRatio: 0.8,
        totalImageCoverageRatio: 0.7,
        largeImageCount: 3,
        images: [{ opIndex: 0 }, { opIndex: 1 }, { opIndex: 2 }] as never[],
      })

      const page = createMockPage()
      const result = await analyzePage(page, 0)

      expect(result.maxImageCoverageRatio).toBe(0.8)
      expect(result.totalImageCoverageRatio).toBe(0.7)
      expect(result.largeImageCount).toBe(3)
      expect(result.imageOpCount).toBe(3)
    })
  })

  describe('options', () => {
    it('uses default options when not provided', async () => {
      const page = createMockPage()
      await analyzePage(page, 0)

      expect(classifyPageKind).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Object),
        expect.objectContaining({
          minCharsForTextPage: 20,
          ignoreSmallImagesBelowCoverage: 0.02,
        }),
      )
    })

    it('respects custom minCharsForTextPage', async () => {
      const page = createMockPage()
      await analyzePage(page, 0, { minCharsForTextPage: 50 })

      expect(classifyPageKind).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Object),
        expect.objectContaining({
          minCharsForTextPage: 50,
        }),
      )
    })

    it('respects custom maxTextSampleChars', async () => {
      const longText = 'x'.repeat(300)
      vi.mocked(getPageTextContent).mockResolvedValueOnce({
        items: [{ str: longText }],
      })

      const page = createMockPage()
      const result = await analyzePage(page, 0, { maxTextSampleChars: 100 })

      expect(result.textSample.length).toBe(100)
    })
  })
})
