import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCMapUrl, getStandardFontDataUrl, loadPdfDocumentFromBytes } from './pdfjs.js'

describe('pdfjs module', () => {
  describe('getStandardFontDataUrl', () => {
    it('returns a string path', () => {
      const url = getStandardFontDataUrl()
      expect(typeof url).toBe('string')
      expect(url.length).toBeGreaterThan(0)
    })

    it('ends with path separator', () => {
      const url = getStandardFontDataUrl()
      expect(url.endsWith(path.sep)).toBe(true)
    })

    it('points to existing directory', async () => {
      const url = getStandardFontDataUrl()
      const stats = await fs.stat(url)
      expect(stats.isDirectory()).toBe(true)
    })

    it('contains pdfjs-dist standard_fonts directory', () => {
      const url = getStandardFontDataUrl()
      expect(url).toContain('pdfjs-dist')
      expect(url).toContain('standard_fonts')
    })
  })

  describe('getCMapUrl', () => {
    it('returns a string path', () => {
      const url = getCMapUrl()
      expect(typeof url).toBe('string')
      expect(url.length).toBeGreaterThan(0)
    })

    it('ends with path separator', () => {
      const url = getCMapUrl()
      expect(url.endsWith(path.sep)).toBe(true)
    })

    it('points to existing directory', async () => {
      const url = getCMapUrl()
      const stats = await fs.stat(url)
      expect(stats.isDirectory()).toBe(true)
    })

    it('contains pdfjs-dist cmaps directory', () => {
      const url = getCMapUrl()
      expect(url).toContain('pdfjs-dist')
      expect(url).toContain('cmaps')
    })
  })

  describe('loadPdfDocumentFromBytes', () => {
    it('loads valid PDF and returns PDFDocumentProxy', async () => {
      const pdfPath = path.resolve('samples/born-digital.pdf')
      const bytes = new Uint8Array(await fs.readFile(pdfPath))
      const doc = await loadPdfDocumentFromBytes(bytes)

      try {
        expect(doc.numPages).toBeGreaterThan(0)
        expect(typeof doc.getPage).toBe('function')
      } finally {
        await doc.cleanup?.()
        await doc.destroy?.()
      }
    })

    it('provides access to page data', async () => {
      const pdfPath = path.resolve('samples/born-digital.pdf')
      const bytes = new Uint8Array(await fs.readFile(pdfPath))
      const doc = await loadPdfDocumentFromBytes(bytes)

      try {
        const page = await doc.getPage(1)
        expect(page).toBeDefined()
        expect(typeof page.getViewport).toBe('function')
        expect(typeof page.getTextContent).toBe('function')
      } finally {
        await doc.cleanup?.()
        await doc.destroy?.()
      }
    })

    it('rejects with invalid PDF bytes', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      await expect(loadPdfDocumentFromBytes(bytes)).rejects.toThrow()
    })

    it('rejects with empty byte array', async () => {
      const bytes = new Uint8Array([])
      await expect(loadPdfDocumentFromBytes(bytes)).rejects.toThrow()
    })

    it('rejects with non-PDF data', async () => {
      // A PNG header
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      await expect(loadPdfDocumentFromBytes(bytes)).rejects.toThrow()
    })
  })
})
