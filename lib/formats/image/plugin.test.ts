import fs from 'node:fs/promises'
import path from 'node:path'

import { imagePlugin } from './plugin.js'
import type { ImageLoadedDocument, ImageUnit } from './types.js'

// Test sample paths
const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../../cli/fixtures')
const SAMPLE_PNG = path.join(FIXTURES_DIR, 'solid-red.png')
const SAMPLE_JPG = path.join(FIXTURES_DIR, 'solid-green.jpg')
const SAMPLE_SVG = path.join(FIXTURES_DIR, 'test.svg')

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
}

describe('imagePlugin', () => {
  describe('identity', () => {
    it('has correct id', () => {
      expect(imagePlugin.id).toBe('image')
    })

    it('has correct extensions', () => {
      expect(imagePlugin.extensions).toContain('.png')
      expect(imagePlugin.extensions).toContain('.PNG')
      expect(imagePlugin.extensions).toContain('.jpg')
      expect(imagePlugin.extensions).toContain('.JPG')
      expect(imagePlugin.extensions).toContain('.jpeg')
      expect(imagePlugin.extensions).toContain('.gif')
      expect(imagePlugin.extensions).toContain('.webp')
      expect(imagePlugin.extensions).toContain('.svg')
    })

    it('has correct mime types', () => {
      expect(imagePlugin.mimeTypes).toContain('image/png')
      expect(imagePlugin.mimeTypes).toContain('image/jpeg')
      expect(imagePlugin.mimeTypes).toContain('image/gif')
      expect(imagePlugin.mimeTypes).toContain('image/webp')
      expect(imagePlugin.mimeTypes).toContain('image/svg+xml')
    })

    it('has correct capabilities', () => {
      expect(imagePlugin.capabilities.ocr).toBe(false)
      expect(imagePlugin.capabilities.vision).toBe(true)
      expect(imagePlugin.capabilities.parallel).toBe(false)
      expect(imagePlugin.capabilities.supportsRuns).toBe(false)
      expect(imagePlugin.capabilities.multiUnit).toBe(false)
    })
  })

  describe('load', () => {
    it('loads PNG from file path', async () => {
      if (!(await fileExists(SAMPLE_PNG))) {
        console.log('Skipping test: solid-red.png not found')
        return
      }

      const doc = await imagePlugin.load(SAMPLE_PNG)
      expect(doc.format).toBe('image')
      expect(doc.bytes).toBeInstanceOf(Uint8Array)
      expect(doc.bytes.length).toBeGreaterThan(0)
      expect((doc as ImageLoadedDocument).imageFormat).toBe('png')
      expect((doc as ImageLoadedDocument).mimeType).toBe('image/png')
      expect((doc as ImageLoadedDocument).width).toBeGreaterThan(0)
      expect((doc as ImageLoadedDocument).height).toBeGreaterThan(0)

      await imagePlugin.cleanup?.(doc)
    })

    it('loads JPG from file path', async () => {
      if (!(await fileExists(SAMPLE_JPG))) {
        console.log('Skipping test: solid-green.jpg not found')
        return
      }

      const doc = await imagePlugin.load(SAMPLE_JPG)
      expect(doc.format).toBe('image')
      expect((doc as ImageLoadedDocument).imageFormat).toBe('jpg')
      expect((doc as ImageLoadedDocument).mimeType).toBe('image/jpeg')

      await imagePlugin.cleanup?.(doc)
    })

    it('loads SVG from file path', async () => {
      if (!(await fileExists(SAMPLE_SVG))) {
        console.log('Skipping test: test.svg not found')
        return
      }

      const doc = await imagePlugin.load(SAMPLE_SVG)
      expect(doc.format).toBe('image')
      expect((doc as ImageLoadedDocument).imageFormat).toBe('svg')
      expect((doc as ImageLoadedDocument).mimeType).toBe('image/svg+xml')

      await imagePlugin.cleanup?.(doc)
    })

    it('loads from Uint8Array', async () => {
      // Create a minimal PNG (1x1 transparent pixel)
      const pngBytes = new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG signature
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52, // IHDR chunk
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01,
        0x08,
        0x06,
        0x00,
        0x00,
        0x00,
        0x1f,
        0x15,
        0xc4,
        0x89,
        0x00,
        0x00,
        0x00,
        0x0a,
        0x49,
        0x44,
        0x41, // IDAT chunk
        0x54,
        0x78,
        0x9c,
        0x63,
        0x00,
        0x01,
        0x00,
        0x00,
        0x05,
        0x00,
        0x01,
        0x0d,
        0x0a,
        0x2d,
        0xb4,
        0x00,
        0x00,
        0x00,
        0x00,
        0x49,
        0x45,
        0x4e,
        0x44,
        0xae, // IEND chunk
        0x42,
        0x60,
        0x82,
      ])

      const doc = await imagePlugin.load(pngBytes)
      expect(doc.format).toBe('image')
      expect((doc as ImageLoadedDocument).imageFormat).toBe('png')
      expect((doc as ImageLoadedDocument).source).toBe('buffer')

      await imagePlugin.cleanup?.(doc)
    })

    it('rejects invalid input', async () => {
      await expect(imagePlugin.load(123 as unknown as string)).rejects.toThrow()
    })
  })

  describe('parse', () => {
    it('parses image as single unit', async () => {
      if (!(await fileExists(SAMPLE_PNG))) {
        console.log('Skipping test: solid-red.png not found')
        return
      }

      const doc = await imagePlugin.load(SAMPLE_PNG)
      const { units, metadata } = await imagePlugin.parse(doc)

      expect(units.length).toBe(1)
      expect(units[0].index).toBe(0)
      expect(units[0].kind).toBe('image-only')
      expect(metadata).toBeDefined()
      expect(metadata?.format).toBe('png')

      await imagePlugin.cleanup?.(doc)
    })
  })

  describe('classifyUnit', () => {
    it('always classifies as image-only', () => {
      const unit: ImageUnit = {
        index: 0,
        label: 'test.png',
        kind: 'unknown',
        charCount: 0,
        language: 'und',
        textSample: '',
        width: 100,
        height: 100,
        fileSize: 1000,
        imageFormat: 'png',
        mimeType: 'image/png',
        resized: false,
      }

      const kind = imagePlugin.classifyUnit(unit)
      expect(kind).toBe('image-only')
    })
  })

  describe('buildRunKey', () => {
    it('does not support runs', () => {
      // Image plugin doesn't support runs, so buildRunKey should not be defined
      expect(imagePlugin.buildRunKey).toBeUndefined()
    })
  })

  describe('getCliOptions', () => {
    it('returns CLI options', () => {
      const options = imagePlugin.getCliOptions?.()

      expect(options).toBeDefined()
      expect(options?.length).toBeGreaterThan(0)
      expect(options?.some((o) => o.flags.includes('--max-dimension'))).toBe(true)
      expect(options?.some((o) => o.flags.includes('--quality'))).toBe(true)
      expect(options?.some((o) => o.flags.includes('--metadata-only'))).toBe(true)
      expect(options?.some((o) => o.flags.includes('--analyze'))).toBe(true)
      expect(options?.some((o) => o.flags.includes('--vision-model'))).toBe(true)
    })
  })
})

describe('imagePlugin integration', () => {
  it('full extraction pipeline for PNG', async () => {
    if (!(await fileExists(SAMPLE_PNG))) {
      console.log('Skipping test: solid-red.png not found')
      return
    }

    const doc = await imagePlugin.load(SAMPLE_PNG)

    try {
      // Parse
      const { units } = await imagePlugin.parse(doc)
      expect(units.length).toBe(1)

      // Analyze
      const analyzed = await imagePlugin.analyzeUnit(units[0], doc)
      analyzed.kind = imagePlugin.classifyUnit(analyzed)
      expect(analyzed.kind).toBe('image-only')
      expect(analyzed.width).toBeGreaterThan(0)
      expect(analyzed.height).toBeGreaterThan(0)

      // Extract (returns placeholder since no OCR/vision)
      const result = await imagePlugin.extractUnit(analyzed, doc)
      expect(result.text).toBeDefined()
      expect(result.text).toContain('[Image:')
      expect(result.extraction.method).toBe('digital')
      expect(result.extraction.reliability).toBe('low')
    } finally {
      await imagePlugin.cleanup?.(doc)
    }
  })

  it('full extraction pipeline for JPG', async () => {
    if (!(await fileExists(SAMPLE_JPG))) {
      console.log('Skipping test: solid-green.jpg not found')
      return
    }

    const doc = await imagePlugin.load(SAMPLE_JPG)

    try {
      const { units } = await imagePlugin.parse(doc)
      expect(units.length).toBe(1)

      const analyzed = await imagePlugin.analyzeUnit(units[0], doc)
      expect(analyzed.imageFormat).toBe('jpg')
    } finally {
      await imagePlugin.cleanup?.(doc)
    }
  })

  it('renders image with base64 data', async () => {
    if (!(await fileExists(SAMPLE_PNG))) {
      console.log('Skipping test: solid-red.png not found')
      return
    }

    const doc = await imagePlugin.load(SAMPLE_PNG)

    try {
      const { units } = await imagePlugin.parse(doc)
      expect(imagePlugin.renderUnit).toBeDefined()
      const rendered = await imagePlugin.renderUnit?.(units[0], doc)

      expect(rendered?.base64).toBeDefined()
      expect(rendered?.base64?.length).toBeGreaterThan(0)
      expect(rendered?.mimeType).toBe('image/png')
      expect(rendered?.width).toBeGreaterThan(0)
      expect(rendered?.height).toBeGreaterThan(0)
    } finally {
      await imagePlugin.cleanup?.(doc)
    }
  })

  it('renders with scale option', async () => {
    if (!(await fileExists(SAMPLE_PNG))) {
      console.log('Skipping test: solid-red.png not found')
      return
    }

    const doc = await imagePlugin.load(SAMPLE_PNG)

    try {
      const { units } = await imagePlugin.parse(doc)
      const originalDoc = doc as ImageLoadedDocument
      const originalWidth = originalDoc.width
      const originalHeight = originalDoc.height

      // Render at 50% scale
      expect(imagePlugin.renderUnit).toBeDefined()
      const rendered = await imagePlugin.renderUnit?.(units[0], doc, { scale: 0.5 })

      // Output dimensions should be smaller or equal to scaled max dimension
      const maxScaledDim = Math.round(Math.max(originalWidth, originalHeight) * 0.5)
      expect(rendered?.width).toBeLessThanOrEqual(maxScaledDim)
      expect(rendered?.height).toBeLessThanOrEqual(maxScaledDim)
    } finally {
      await imagePlugin.cleanup?.(doc)
    }
  })
})
