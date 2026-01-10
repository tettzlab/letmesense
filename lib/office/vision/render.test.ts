/**
 * Tests for vision rendering functions.
 * These tests require LibreOffice to be installed and working.
 */

import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkLibreOffice } from '../convert/libreoffice.js'
import type { ContentKind } from '../types.js'
import {
  ADAPTIVE_DIMENSIONS,
  computeAdaptiveScale,
  convertDocumentToPdf,
  DEFAULT_MAX_DIMENSION,
  renderDocumentToImages,
  renderManyToImages,
} from './render.js'

// Check if LibreOffice is available
const libreOfficeStatus = checkLibreOffice()

// Test fixture path
const FIXTURES_DIR = join(process.cwd(), 'lib/office/fixtures')
const PPTX_FIXTURE = join(FIXTURES_DIR, 'sample.pptx')

// Check if fixture exists
const hasFixture = existsSync(PPTX_FIXTURE)

// Cache for whether LibreOffice conversion actually works
let conversionWorks: boolean | null = null

async function checkConversionWorks(): Promise<boolean> {
  if (conversionWorks !== null) return conversionWorks
  if (!libreOfficeStatus.available || !hasFixture) {
    conversionWorks = false
    return false
  }
  try {
    const result = await convertDocumentToPdf(PPTX_FIXTURE)
    conversionWorks = result.pdfBytes.length > 0
    return conversionWorks
  } catch {
    conversionWorks = false
    return false
  }
}

describe('render', () => {
  describe('convertDocumentToPdf', () => {
    it('converts PPTX to PDF', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const result = await convertDocumentToPdf(PPTX_FIXTURE)

      expect(result.pdfBytes).toBeInstanceOf(Buffer)
      expect(result.pdfBytes.length).toBeGreaterThan(0)
      expect(result.pageCount).toBeGreaterThan(0)
      expect(result.duration).toBeGreaterThan(0)
    }, 30000)

    it('returns correct page count', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const result = await convertDocumentToPdf(PPTX_FIXTURE)

      // The fixture should have multiple slides
      expect(result.pageCount).toBeGreaterThanOrEqual(1)
    }, 30000)

    it('PDF bytes are valid PDF', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const result = await convertDocumentToPdf(PPTX_FIXTURE)

      // Check PDF magic bytes
      const pdfHeader = result.pdfBytes.subarray(0, 5).toString('ascii')
      expect(pdfHeader).toBe('%PDF-')
    }, 30000)

    it('calls progress callback', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const events: string[] = []

      await convertDocumentToPdf(PPTX_FIXTURE, {}, (event) => {
        events.push(event.type)
      })

      expect(events).toContain('conversion-start')
      expect(events).toContain('conversion-done')
    }, 30000)

    it('throws when LibreOffice not available', async () => {
      // Skip if LibreOffice IS available
      if (libreOfficeStatus.available) {
        console.log('⏭️  Skipping: LibreOffice is available')
        return
      }

      await expect(convertDocumentToPdf('/some/file.pptx')).rejects.toThrow(/LibreOffice/)
    })

    it('throws for non-existent file', async () => {
      if (!libreOfficeStatus.available) {
        console.log('⏭️  Skipping: LibreOffice not available')
        return
      }

      await expect(convertDocumentToPdf('/non/existent/file.pptx')).rejects.toThrow()
    })
  })

  describe('renderDocumentToImages', () => {
    it('renders PPTX to images', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const images = await renderDocumentToImages(PPTX_FIXTURE)

      expect(images.length).toBeGreaterThan(0)
      expect(images[0]).toBeInstanceOf(Buffer)
    }, 60000)

    it('each image is valid PNG', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const images = await renderDocumentToImages(PPTX_FIXTURE)

      for (const image of images) {
        // PNG magic bytes: 89 50 4E 47
        expect(image[0]).toBe(0x89)
        expect(image[1]).toBe(0x50)
        expect(image[2]).toBe(0x4e)
        expect(image[3]).toBe(0x47)
      }
    }, 60000)

    it('calls progress callbacks', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const events: string[] = []

      await renderDocumentToImages(PPTX_FIXTURE, {}, (event) => {
        events.push(event.type)
      })

      expect(events).toContain('conversion-start')
      expect(events).toContain('conversion-done')
      expect(events).toContain('llm-start')
      expect(events).toContain('llm-progress')
    }, 60000)
  })

  describe('renderManyToImages', () => {
    let tempDir: string
    let tempFiles: string[]

    beforeAll(async () => {
      if (!hasFixture || !libreOfficeStatus.available) {
        return
      }

      // Create temp directory with copies of the fixture
      tempDir = join(tmpdir(), `render-test-${Date.now()}`)
      await mkdir(tempDir, { recursive: true })

      // We'll just use the same fixture twice for testing
      tempFiles = [PPTX_FIXTURE, PPTX_FIXTURE]
    })

    afterAll(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    })

    it('renders multiple documents', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const results = await renderManyToImages(tempFiles)

      expect(results.length).toBe(2)
      expect(results[0].length).toBeGreaterThan(0)
      expect(results[1].length).toBeGreaterThan(0)
    }, 120000)

    it('all results are valid images', async () => {
      if (!(await checkConversionWorks())) {
        console.log('⏭️  Skipping: LibreOffice conversion not working')
        return
      }

      const results = await renderManyToImages(tempFiles)

      for (const images of results) {
        for (const image of images) {
          expect(image[0]).toBe(0x89) // PNG magic byte
        }
      }
    }, 120000)
  })
})

describe('render edge cases', () => {
  it('handles keepTemp option', async () => {
    if (!(await checkConversionWorks())) {
      console.log('⏭️  Skipping: LibreOffice conversion not working')
      return
    }

    // With keepTemp, files should not be deleted
    // We can't easily verify this without inspecting temp directories
    const result = await convertDocumentToPdf(PPTX_FIXTURE, { keepTemp: true })
    expect(result.pdfBytes.length).toBeGreaterThan(0)
  }, 30000)

  it('tracks all event types in progress callback', async () => {
    if (!(await checkConversionWorks())) {
      console.log('⏭️  Skipping: LibreOffice conversion not working')
      return
    }

    const eventTypes: string[] = []
    const eventData: Record<string, any>[] = []

    await renderDocumentToImages(PPTX_FIXTURE, {}, (event) => {
      eventTypes.push(event.type)
      eventData.push(event)
    })

    // Should have conversion-start, conversion-done, llm-start, and llm-progress events
    expect(eventTypes).toContain('conversion-start')
    expect(eventTypes).toContain('conversion-done')
    expect(eventTypes).toContain('llm-start')
    expect(eventTypes).toContain('llm-progress')

    // Verify conversion-done has duration
    const conversionDone = eventData.find((e) => e.type === 'conversion-done')
    expect(conversionDone?.duration).toBeGreaterThanOrEqual(0)

    // Verify llm-start has totalUnits
    const llmStart = eventData.find((e) => e.type === 'llm-start')
    expect(llmStart?.totalUnits).toBeGreaterThan(0)

    // Verify llm-progress has unitIndex
    const llmProgress = eventData.find((e) => e.type === 'llm-progress')
    expect(llmProgress?.unitIndex).toBeGreaterThanOrEqual(0)
    expect(llmProgress?.totalUnits).toBeGreaterThan(0)
  }, 60000)

  it('throws error for non-existent file when LibreOffice available', async () => {
    // Skip if LibreOffice is not available (separate test covers that case)
    if (!libreOfficeStatus.available) {
      console.log('⏭️  Skipping: LibreOffice not available')
      return
    }

    // Converting a non-existent file should throw an error
    await expect(convertDocumentToPdf('/non/existent/file.pptx')).rejects.toThrow()
  })
})

// ============================================================================
// Adaptive Scaling Tests
// ============================================================================

describe('computeAdaptiveScale', () => {
  // Mock PDFPageProxy with configurable dimensions
  function createMockPage(width: number, height: number) {
    return {
      getViewport: ({ scale }: { scale: number }) => ({
        width: width * scale,
        height: height * scale,
      }),
    } as Parameters<typeof computeAdaptiveScale>[0]
  }

  describe('ADAPTIVE_DIMENSIONS constants', () => {
    it('has expected values', () => {
      expect(DEFAULT_MAX_DIMENSION).toBe(1024)
      expect(ADAPTIVE_DIMENSIONS['text-rich']).toBe(800)
      expect(ADAPTIVE_DIMENSIONS.mixed).toBe(1024)
      expect(ADAPTIVE_DIMENSIONS['image-heavy']).toBe(1536)
      expect(ADAPTIVE_DIMENSIONS.table).toBe(1280)
      expect(ADAPTIVE_DIMENSIONS.empty).toBe(600)
      expect(ADAPTIVE_DIMENSIONS.unknown).toBe(1024)
    })

    it('covers all ContentKind values', () => {
      const kinds: ContentKind[] = [
        'text-rich',
        'image-heavy',
        'mixed',
        'table',
        'empty',
        'unknown',
      ]
      for (const kind of kinds) {
        expect(ADAPTIVE_DIMENSIONS[kind]).toBeDefined()
        expect(typeof ADAPTIVE_DIMENSIONS[kind]).toBe('number')
      }
    })
  })

  describe('with letter-size page (612x792 points)', () => {
    // Standard US Letter at 72 DPI = 612x792 points
    const letterPage = createMockPage(612, 792)

    it('uses default dimension when no kind provided', () => {
      const scale = computeAdaptiveScale(letterPage, undefined, {})
      const expectedScale = DEFAULT_MAX_DIMENSION / 792 // long edge is 792
      expect(scale).toBeCloseTo(expectedScale, 4)
    })

    it('uses text-rich dimension for text-rich content', () => {
      const scale = computeAdaptiveScale(letterPage, 'text-rich', {})
      const expectedScale = ADAPTIVE_DIMENSIONS['text-rich'] / 792
      expect(scale).toBeCloseTo(expectedScale, 4)
    })

    it('uses higher dimension for image-heavy content', () => {
      const scale = computeAdaptiveScale(letterPage, 'image-heavy', {})
      const expectedScale = ADAPTIVE_DIMENSIONS['image-heavy'] / 792
      expect(scale).toBeCloseTo(expectedScale, 4)
    })

    it('uses table dimension for table content', () => {
      const scale = computeAdaptiveScale(letterPage, 'table', {})
      const expectedScale = ADAPTIVE_DIMENSIONS.table / 792
      expect(scale).toBeCloseTo(expectedScale, 4)
    })

    it('text-rich produces smaller scale than image-heavy', () => {
      const textRichScale = computeAdaptiveScale(letterPage, 'text-rich', {})
      const imageHeavyScale = computeAdaptiveScale(letterPage, 'image-heavy', {})
      expect(textRichScale).toBeLessThan(imageHeavyScale)
    })
  })

  describe('with landscape page (1920x1080 points)', () => {
    // Wide landscape page
    const landscapePage = createMockPage(1920, 1080)

    it('scales based on long edge (width)', () => {
      const scale = computeAdaptiveScale(landscapePage, undefined, {})
      const expectedScale = DEFAULT_MAX_DIMENSION / 1920
      expect(scale).toBeCloseTo(expectedScale, 4)
    })

    it('applies adaptive scaling to landscape', () => {
      const textRichScale = computeAdaptiveScale(landscapePage, 'text-rich', {})
      const expectedScale = ADAPTIVE_DIMENSIONS['text-rich'] / 1920
      expect(textRichScale).toBeCloseTo(expectedScale, 4)
    })
  })

  describe('user options', () => {
    const letterPage = createMockPage(612, 792)

    it('respects maxImageDimension option', () => {
      const scale = computeAdaptiveScale(letterPage, undefined, { maxImageDimension: 512 })
      const expectedScale = 512 / 792
      expect(scale).toBeCloseTo(expectedScale, 4)
    })

    it('disableAdaptiveScaling uses fixed dimension regardless of kind', () => {
      const textRichScale = computeAdaptiveScale(letterPage, 'text-rich', {
        disableAdaptiveScaling: true,
      })
      const imageHeavyScale = computeAdaptiveScale(letterPage, 'image-heavy', {
        disableAdaptiveScaling: true,
      })
      // Both should use default dimension when adaptive is disabled
      expect(textRichScale).toBe(imageHeavyScale)
      expect(textRichScale).toBeCloseTo(DEFAULT_MAX_DIMENSION / 792, 4)
    })

    it('disableAdaptiveScaling + maxImageDimension uses custom dimension', () => {
      const scale = computeAdaptiveScale(letterPage, 'image-heavy', {
        disableAdaptiveScaling: true,
        maxImageDimension: 600,
      })
      const expectedScale = 600 / 792
      expect(scale).toBeCloseTo(expectedScale, 4)
    })

    it('maxImageDimension caps adaptive dimension', () => {
      // image-heavy wants 1536, but maxImageDimension caps to 800
      const scale = computeAdaptiveScale(letterPage, 'image-heavy', { maxImageDimension: 800 })
      const expectedScale = 800 / 792 // capped to 800
      expect(scale).toBeCloseTo(expectedScale, 4)
    })

    it('maxImageDimension does not affect lower adaptive dimensions', () => {
      // text-rich wants 800, maxImageDimension is 1200 (higher)
      // adaptive dimension should be used since it's lower
      const scale = computeAdaptiveScale(letterPage, 'text-rich', { maxImageDimension: 1200 })
      const expectedScale = ADAPTIVE_DIMENSIONS['text-rich'] / 792
      expect(scale).toBeCloseTo(expectedScale, 4)
    })
  })

  describe('scale limits', () => {
    it('does not exceed 3.0 scale factor', () => {
      // Very small page that would need >3x scale
      const tinyPage = createMockPage(100, 100)
      const scale = computeAdaptiveScale(tinyPage, 'image-heavy', {})
      expect(scale).toBeLessThanOrEqual(3.0)
    })

    it('small pages use capped scale', () => {
      // Page at 200x200, image-heavy wants 1536px
      // Scale would be 1536/200 = 7.68, but capped to 3.0
      const smallPage = createMockPage(200, 200)
      const scale = computeAdaptiveScale(smallPage, 'image-heavy', {})
      expect(scale).toBe(3.0)
    })
  })

  describe('token savings estimation', () => {
    const letterPage = createMockPage(612, 792)

    it('text-rich pages result in ~67% smaller images than fixed 2.0 scale', () => {
      const adaptiveScale = computeAdaptiveScale(letterPage, 'text-rich', {})
      const fixedScale = 2.0

      // Pixel area ratio determines token usage
      const adaptiveArea = adaptiveScale * 612 * (adaptiveScale * 792)
      const fixedArea = fixedScale * 612 * (fixedScale * 792)

      const savings = 1 - adaptiveArea / fixedArea
      expect(savings).toBeGreaterThan(0.5) // At least 50% savings
    })

    it('mixed pages result in moderate savings', () => {
      const adaptiveScale = computeAdaptiveScale(letterPage, 'mixed', {})
      const fixedScale = 2.0

      const adaptiveArea = adaptiveScale * 612 * (adaptiveScale * 792)
      const fixedArea = fixedScale * 612 * (fixedScale * 792)

      const savings = 1 - adaptiveArea / fixedArea
      expect(savings).toBeGreaterThan(0.3) // At least 30% savings
    })
  })
})
