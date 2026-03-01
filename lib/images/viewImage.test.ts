/**
 * Tests for image viewing tool.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { MAX_IMAGE_FILE_BYTES, runViewImage } from './viewImage.js'

describe('viewImage', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewimage-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // Helper to create a simple PNG image
  async function createTestPng(
    width: number,
    height: number,
    color: { r: number; g: number; b: number } = { r: 255, g: 0, b: 0 },
  ): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: color,
      },
    })
      .png()
      .toBuffer()
  }

  // Helper to create a simple JPEG image
  async function createTestJpg(
    width: number,
    height: number,
    color: { r: number; g: number; b: number } = { r: 0, g: 255, b: 0 },
  ): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: color,
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer()
  }

  describe('Format Detection', () => {
    it('detects PNG from extension', async () => {
      const pngBuffer = await createTestPng(100, 100)
      const filePath = path.join(tmpDir, 'test.png')
      await fs.writeFile(filePath, pngBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.format).toBe('png')
        expect(result.mimeType).toBe('image/png')
      }
    })

    it('detects JPG from extension', async () => {
      const jpgBuffer = await createTestJpg(100, 100)
      const filePath = path.join(tmpDir, 'test.jpg')
      await fs.writeFile(filePath, jpgBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.jpg' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.format).toBe('jpg')
        expect(result.mimeType).toBe('image/jpeg')
      }
    })

    it('detects JPEG from extension (alias)', async () => {
      const jpgBuffer = await createTestJpg(100, 100)
      const filePath = path.join(tmpDir, 'test.jpeg')
      await fs.writeFile(filePath, jpgBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.jpeg' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.format).toBe('jpg')
      }
    })

    it('detects WebP from extension', async () => {
      const webpBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
      })
        .webp()
        .toBuffer()
      const filePath = path.join(tmpDir, 'test.webp')
      await fs.writeFile(filePath, webpBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.webp' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.format).toBe('webp')
        expect(result.mimeType).toBe('image/webp')
      }
    })

    it('detects GIF from extension', async () => {
      const gifBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 0 } },
      })
        .gif()
        .toBuffer()
      const filePath = path.join(tmpDir, 'test.gif')
      await fs.writeFile(filePath, gifBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.gif' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.format).toBe('gif')
        expect(result.mimeType).toBe('image/gif')
      }
    })

    it('returns error for unknown extension', async () => {
      const filePath = path.join(tmpDir, 'test.xyz')
      await fs.writeFile(filePath, 'not an image')

      const result = await runViewImage(filePath, { filePath: 'test.xyz' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('UNKNOWN_FORMAT')
        expect(result.error).toContain('.xyz')
      }
    })

    it('returns error for no extension', async () => {
      const filePath = path.join(tmpDir, 'testfile')
      await fs.writeFile(filePath, 'not an image')

      const result = await runViewImage(filePath, { filePath: 'testfile' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('UNKNOWN_FORMAT')
        expect(result.error).toContain('no extension')
      }
    })

    it('allows explicit format override', async () => {
      // Create a PNG but save with wrong extension
      const pngBuffer = await createTestPng(100, 100)
      const filePath = path.join(tmpDir, 'actually-png.dat')
      await fs.writeFile(filePath, pngBuffer)

      const result = await runViewImage(filePath, { filePath: 'actually-png.dat', format: 'png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.format).toBe('png')
      }
    })
  })

  describe('File Validation', () => {
    it('returns ENOENT for missing files', async () => {
      const result = await runViewImage('/nonexistent/path/image.png', { filePath: 'image.png' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('ENOENT')
      }
    })

    it('returns PARSE for empty files', async () => {
      const filePath = path.join(tmpDir, 'empty.png')
      await fs.writeFile(filePath, '')

      const result = await runViewImage(filePath, { filePath: 'empty.png' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('PARSE')
        expect(result.error).toContain('empty')
      }
    })

    it('returns LIMIT for oversized files', async () => {
      // Create a file that exceeds MAX_IMAGE_FILE_BYTES
      const filePath = path.join(tmpDir, 'large.png')
      const size = MAX_IMAGE_FILE_BYTES + 1024 // Just over the limit
      await fs.writeFile(filePath, Buffer.alloc(size))

      const result = await runViewImage(filePath, { filePath: 'large.png' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('LIMIT')
        expect(result.error).toContain('too large')
      }
    })
  })

  describe('SVG Handling', () => {
    it('extracts viewBox dimensions', async () => {
      const svg = '<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg"><rect/></svg>'
      const filePath = path.join(tmpDir, 'test.svg')
      await fs.writeFile(filePath, svg)

      const result = await runViewImage(filePath, { filePath: 'test.svg' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.format).toBe('svg')
        expect(result.width).toBe(200)
        expect(result.height).toBe(100)
        expect(result.resized).toBe(false)
      }
    })

    it('extracts width/height attributes as fallback', async () => {
      const svg = '<svg width="150" height="75" xmlns="http://www.w3.org/2000/svg"></svg>'
      const filePath = path.join(tmpDir, 'test.svg')
      await fs.writeFile(filePath, svg)

      const result = await runViewImage(filePath, { filePath: 'test.svg' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.width).toBe(150)
        expect(result.height).toBe(75)
      }
    })

    it('returns base64 SVG data', async () => {
      const svg = '<svg viewBox="0 0 100 50"><circle cx="50" cy="25" r="20"/></svg>'
      const filePath = path.join(tmpDir, 'test.svg')
      await fs.writeFile(filePath, svg)

      const result = await runViewImage(filePath, { filePath: 'test.svg' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.mimeType).toBe('image/svg+xml')
        expect(result.data).toBeDefined()
        // Decode and verify content
        const data = result.data
        if (data) {
          const decoded = Buffer.from(data, 'base64').toString('utf8')
          expect(decoded).toContain('<circle')
        }
      }
    })

    it('SVG metadataOnly omits data', async () => {
      const svg = '<svg viewBox="0 0 100 50"><rect/></svg>'
      const filePath = path.join(tmpDir, 'test.svg')
      await fs.writeFile(filePath, svg)

      const result = await runViewImage(filePath, { filePath: 'test.svg', metadataOnly: true })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeUndefined()
        expect(result.mimeType).toBeUndefined()
        expect(result.width).toBe(100)
        expect(result.height).toBe(50)
      }
    })
  })

  describe('Raster Image Processing', () => {
    it('reads PNG dimensions correctly', async () => {
      const pngBuffer = await createTestPng(320, 240)
      const filePath = path.join(tmpDir, 'test.png')
      await fs.writeFile(filePath, pngBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.width).toBe(320)
        expect(result.height).toBe(240)
        expect(result.bytes).toBeGreaterThan(0)
      }
    })

    it('returns base64 data for small images', async () => {
      const pngBuffer = await createTestPng(50, 50)
      const filePath = path.join(tmpDir, 'small.png')
      await fs.writeFile(filePath, pngBuffer)

      const result = await runViewImage(filePath, { filePath: 'small.png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeDefined()
        const data = result.data
        if (data) {
          expect(data.length).toBeGreaterThan(0)
          // Verify it's valid base64 that can be decoded
          const decoded = Buffer.from(data, 'base64')
          expect(decoded.length).toBeGreaterThan(0)
        }
      }
    })

    it('includes metadata for raster images', async () => {
      const pngBuffer = await createTestPng(100, 100)
      const filePath = path.join(tmpDir, 'test.png')
      await fs.writeFile(filePath, pngBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.metadata).toBeDefined()
        expect(result.metadata?.colorSpace).toBeDefined()
      }
    })
  })

  describe('metadataOnly Mode', () => {
    it('omits data when metadataOnly is true', async () => {
      const pngBuffer = await createTestPng(100, 100)
      const filePath = path.join(tmpDir, 'test.png')
      await fs.writeFile(filePath, pngBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.png', metadataOnly: true })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeUndefined()
        expect(result.mimeType).toBeUndefined()
        expect(result.width).toBe(100)
        expect(result.height).toBe(100)
        expect(result.metadata).toBeDefined()
      }
    })

    it('still provides dimensions and metadata', async () => {
      const jpgBuffer = await createTestJpg(200, 150)
      const filePath = path.join(tmpDir, 'test.jpg')
      await fs.writeFile(filePath, jpgBuffer)

      const result = await runViewImage(filePath, { filePath: 'test.jpg', metadataOnly: true })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.width).toBe(200)
        expect(result.height).toBe(150)
        expect(result.format).toBe('jpg')
        expect(result.bytes).toBeGreaterThan(0)
      }
    })
  })

  describe('Resizing', () => {
    it('resizes large images to maxDimension', async () => {
      const largeBuffer = await createTestPng(2000, 1500)
      const filePath = path.join(tmpDir, 'large.png')
      await fs.writeFile(filePath, largeBuffer)

      const result = await runViewImage(filePath, { filePath: 'large.png', maxDimension: 500 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.resized).toBe(true)
        expect(result.width).toBe(2000) // Original preserved
        expect(result.height).toBe(1500)
        expect(result.outputWidth).toBeLessThanOrEqual(500)
        expect(result.outputHeight).toBeLessThanOrEqual(500)
      }
    })

    it('preserves aspect ratio when resizing', async () => {
      const wideBuffer = await createTestPng(1000, 500) // 2:1 aspect ratio
      const filePath = path.join(tmpDir, 'wide.png')
      await fs.writeFile(filePath, wideBuffer)

      const result = await runViewImage(filePath, { filePath: 'wide.png', maxDimension: 200 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.resized).toBe(true)
        // Should be 200x100 to maintain 2:1 ratio
        expect(result.outputWidth).toBe(200)
        expect(result.outputHeight).toBe(100)
      }
    })

    it('does not resize images smaller than maxDimension', async () => {
      const smallBuffer = await createTestPng(100, 80)
      const filePath = path.join(tmpDir, 'small.png')
      await fs.writeFile(filePath, smallBuffer)

      const result = await runViewImage(filePath, { filePath: 'small.png', maxDimension: 500 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.resized).toBe(false)
        expect(result.outputWidth).toBeUndefined()
        expect(result.outputHeight).toBeUndefined()
      }
    })

    it('uses default maxDimension of 1024', async () => {
      const hugeBuffer = await createTestPng(3000, 2000)
      const filePath = path.join(tmpDir, 'huge.png')
      await fs.writeFile(filePath, hugeBuffer)

      const result = await runViewImage(filePath, { filePath: 'huge.png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.resized).toBe(true)
        expect(result.outputWidth).toBeLessThanOrEqual(1024)
        expect(result.outputHeight).toBeLessThanOrEqual(1024)
      }
    })

    it('respects MAX_IMAGE_OUTPUT_DIMENSION cap', async () => {
      const hugeBuffer = await createTestPng(5000, 4000)
      const filePath = path.join(tmpDir, 'veryhuge.png')
      await fs.writeFile(filePath, hugeBuffer)

      // Try to set maxDimension higher than the cap (2048)
      const result = await runViewImage(filePath, { filePath: 'veryhuge.png', maxDimension: 4000 })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.resized).toBe(true)
        expect(result.outputWidth).toBeLessThanOrEqual(2048)
        expect(result.outputHeight).toBeLessThanOrEqual(2048)
      }
    })
  })

  describe('Quality Settings', () => {
    it('applies quality setting to JPEG output', async () => {
      const jpgBuffer = await createTestJpg(200, 200)
      const filePath = path.join(tmpDir, 'test.jpg')
      await fs.writeFile(filePath, jpgBuffer)

      // Get high quality result
      const highQualityResult = await runViewImage(filePath, {
        filePath: 'test.jpg',
        quality: 100,
      })

      // Get low quality result
      const lowQualityResult = await runViewImage(filePath, {
        filePath: 'test.jpg',
        quality: 20,
      })

      expect(highQualityResult.ok).toBe(true)
      expect(lowQualityResult.ok).toBe(true)

      if (highQualityResult.ok && lowQualityResult.ok) {
        const highData = highQualityResult.data
        const lowData = lowQualityResult.data
        // Low quality should produce smaller base64 output
        if (highData && lowData) {
          expect(lowData.length).toBeLessThan(highData.length)
        }
      }
    })

    it('applies quality setting to WebP output', async () => {
      // Create a more complex image (gradient) to ensure quality affects output size
      // Simple solid colors may compress nearly identically at different qualities
      const width = 400
      const height = 400
      const channels = 3
      const pixels = Buffer.alloc(width * height * channels)
      // Create a gradient pattern
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * channels
          pixels[idx] = x % 256 // R varies with x
          pixels[idx + 1] = y % 256 // G varies with y
          pixels[idx + 2] = (x + y) % 256 // B varies with both
        }
      }
      const webpBuffer = await sharp(pixels, { raw: { width, height, channels } }).webp().toBuffer()
      const filePath = path.join(tmpDir, 'test.webp')
      await fs.writeFile(filePath, webpBuffer)

      const highQualityResult = await runViewImage(filePath, {
        filePath: 'test.webp',
        quality: 100,
      })

      const lowQualityResult = await runViewImage(filePath, {
        filePath: 'test.webp',
        quality: 10, // Use more extreme difference
      })

      expect(highQualityResult.ok).toBe(true)
      expect(lowQualityResult.ok).toBe(true)

      if (highQualityResult.ok && lowQualityResult.ok) {
        const highData = highQualityResult.data
        const lowData = lowQualityResult.data
        if (highData && lowData) {
          // With gradient images and extreme quality difference, low should be smaller
          expect(lowData.length).toBeLessThan(highData.length)
        }
      }
    })
  })

  describe('Result Properties', () => {
    it('includes all expected properties in success result', async () => {
      const pngBuffer = await createTestPng(100, 100)
      const filePath = path.join(tmpDir, 'test.png')
      await fs.writeFile(filePath, pngBuffer)

      const result = await runViewImage(filePath, { filePath: 'assets/test.png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.filePath).toBe('assets/test.png') // Display path preserved
        expect(result.format).toBe('png')
        expect(result.bytes).toBeGreaterThan(0)
        expect(result.width).toBe(100)
        expect(result.height).toBe(100)
        expect(typeof result.resized).toBe('boolean')
        expect(result.mimeType).toBe('image/png')
        expect(result.data).toBeDefined()
      }
    })

    it('includes all expected properties in error result', async () => {
      const result = await runViewImage('/missing/file.png', { filePath: 'file.png' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeDefined()
        expect(typeof result.error).toBe('string')
        expect(result.code).toBeDefined()
      }
    })
  })

  describe('Edge Cases', () => {
    it('handles very small images (1x1)', async () => {
      const tinyBuffer = await createTestPng(1, 1)
      const filePath = path.join(tmpDir, 'tiny.png')
      await fs.writeFile(filePath, tinyBuffer)

      const result = await runViewImage(filePath, { filePath: 'tiny.png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.width).toBe(1)
        expect(result.height).toBe(1)
      }
    })

    it('handles PNG with transparency', async () => {
      const transparentBuffer = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 4, // RGBA
          background: { r: 255, g: 0, b: 0, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer()
      const filePath = path.join(tmpDir, 'transparent.png')
      await fs.writeFile(filePath, transparentBuffer)

      const result = await runViewImage(filePath, { filePath: 'transparent.png' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.metadata?.hasAlpha).toBe(true)
      }
    })

    it('handles corrupt image file gracefully', async () => {
      const filePath = path.join(tmpDir, 'corrupt.png')
      await fs.writeFile(filePath, 'not a valid PNG image data')

      const result = await runViewImage(filePath, { filePath: 'corrupt.png' })
      // Should fail gracefully with an error, not throw
      expect(result).toBeDefined()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeDefined()
        expect(result.code).toBe('PARSE')
      }
    })
  })
})
