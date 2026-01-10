import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { pdfPlugin } from './plugin.js'
import type { PdfLoadedDocument, PdfUnit } from './types.js'

// Test sample path
const SAMPLES_DIR = path.resolve(import.meta.dirname, '../../../samples')
const BORN_DIGITAL_PDF = path.join(SAMPLES_DIR, 'born-digital.pdf')

describe('pdfPlugin', () => {
  describe('identity', () => {
    it('has correct id', () => {
      expect(pdfPlugin.id).toBe('pdf')
    })

    it('has correct extensions', () => {
      expect(pdfPlugin.extensions).toContain('.pdf')
      expect(pdfPlugin.extensions).toContain('.PDF')
    })

    it('has correct mime types', () => {
      expect(pdfPlugin.mimeTypes).toContain('application/pdf')
    })

    it('has correct capabilities', () => {
      expect(pdfPlugin.capabilities.ocr).toBe(true)
      expect(pdfPlugin.capabilities.vision).toBe(true)
      expect(pdfPlugin.capabilities.parallel).toBe(true)
      expect(pdfPlugin.capabilities.supportsRuns).toBe(true)
      expect(pdfPlugin.capabilities.multiUnit).toBe(true)
    })
  })

  describe('load', () => {
    it('loads PDF from file path', async () => {
      const exists = await fs
        .access(BORN_DIGITAL_PDF)
        .then(() => true)
        .catch(() => false)
      if (!exists) {
        console.log('Skipping test: born-digital.pdf not found')
        return
      }

      const doc = await pdfPlugin.load(BORN_DIGITAL_PDF)
      expect(doc.format).toBe('pdf')
      expect(doc.bytes).toBeInstanceOf(Uint8Array)
      expect(doc.bytes.length).toBeGreaterThan(0)
      expect((doc as PdfLoadedDocument).pdf).toBeDefined()

      await pdfPlugin.cleanup?.(doc)
    })

    it('loads PDF from Uint8Array', async () => {
      const exists = await fs
        .access(BORN_DIGITAL_PDF)
        .then(() => true)
        .catch(() => false)
      if (!exists) {
        console.log('Skipping test: born-digital.pdf not found')
        return
      }

      const buffer = await fs.readFile(BORN_DIGITAL_PDF)
      const bytes = new Uint8Array(buffer)

      const doc = await pdfPlugin.load(bytes)
      expect(doc.format).toBe('pdf')
      expect((doc as PdfLoadedDocument).pdf).toBeDefined()

      await pdfPlugin.cleanup?.(doc)
    })

    it('rejects invalid input', async () => {
      await expect(pdfPlugin.load(123 as unknown as string)).rejects.toThrow('Invalid input type')
    })
  })

  describe('parse', () => {
    it('parses PDF into units (pages)', async () => {
      const exists = await fs
        .access(BORN_DIGITAL_PDF)
        .then(() => true)
        .catch(() => false)
      if (!exists) {
        console.log('Skipping test: born-digital.pdf not found')
        return
      }

      const doc = await pdfPlugin.load(BORN_DIGITAL_PDF)

      try {
        const { units } = await pdfPlugin.parse(doc)

        expect(units.length).toBeGreaterThan(0)
        expect(units[0].index).toBe(0)
        expect(units[0].label).toBe('Page 1')
        expect(units[0].kind).toBe('unknown') // Not analyzed yet
        expect(units[0].pageNumber).toBe(1)
      } finally {
        await pdfPlugin.cleanup?.(doc)
      }
    })
  })

  describe('analyzeUnit', () => {
    it('analyzes a page unit', async () => {
      const exists = await fs
        .access(BORN_DIGITAL_PDF)
        .then(() => true)
        .catch(() => false)
      if (!exists) {
        console.log('Skipping test: born-digital.pdf not found')
        return
      }

      const doc = await pdfPlugin.load(BORN_DIGITAL_PDF)

      try {
        const { units } = await pdfPlugin.parse(doc)
        const analyzed = await pdfPlugin.analyzeUnit(units[0], doc)

        // After analysis, should have content classification
        expect(['text-only', 'image-only', 'mixed', 'empty', 'unknown']).toContain(analyzed.kind)
        expect(analyzed.charCount).toBeGreaterThanOrEqual(0)
        expect(analyzed.language).toBeDefined()
        expect(analyzed.paperKey).toBeDefined()
        expect(analyzed.pageKind).toBeDefined()
      } finally {
        await pdfPlugin.cleanup?.(doc)
      }
    })
  })

  describe('classifyUnit', () => {
    it('classifies based on unit attributes', () => {
      const unit: PdfUnit = {
        index: 0,
        label: 'Page 1',
        kind: 'unknown',
        charCount: 1000,
        language: 'eng',
        textSample: 'Lorem ipsum...',
        rotationDeg: 0,
        widthPt: 612,
        heightPt: 792,
        paperKey: '612.0x792.0',
        orientation: 'portrait',
        imageOpCount: 0,
        maxImageCoverageRatio: 0,
        totalImageCoverageRatio: 0,
        largeImageCount: 0,
        pageKind: 'born-digital',
        pageNumber: 1,
      }

      const kind = pdfPlugin.classifyUnit(unit)
      expect(kind).toBe('text-only')
    })

    it('classifies scanned page', () => {
      const unit: PdfUnit = {
        index: 0,
        label: 'Page 1',
        kind: 'unknown',
        charCount: 5, // Very little text
        language: 'und',
        textSample: '',
        rotationDeg: 0,
        widthPt: 612,
        heightPt: 792,
        paperKey: '612.0x792.0',
        orientation: 'portrait',
        imageOpCount: 1,
        maxImageCoverageRatio: 0.95, // Large image
        totalImageCoverageRatio: 0.95,
        largeImageCount: 1,
        pageKind: 'scanned-image',
        pageNumber: 1,
      }

      const kind = pdfPlugin.classifyUnit(unit)
      expect(kind).toBe('image-only')
    })
  })

  describe('buildRunKey', () => {
    it('builds run key from unit attributes', () => {
      const unit: PdfUnit = {
        index: 0,
        label: 'Page 1',
        kind: 'text-only',
        charCount: 1000,
        language: 'eng',
        textSample: 'Lorem ipsum...',
        rotationDeg: 0,
        widthPt: 612,
        heightPt: 792,
        paperKey: '612.0x792.0',
        orientation: 'portrait',
        imageOpCount: 0,
        maxImageCoverageRatio: 0,
        totalImageCoverageRatio: 0,
        largeImageCount: 0,
        pageKind: 'born-digital',
        pageNumber: 1,
      }

      const key = pdfPlugin.buildRunKey?.(unit)
      expect(key).toBe('text-only|612.0x792.0|portrait|eng')
    })
  })

  describe('extractUnit', () => {
    it('extracts text from born-digital page', async () => {
      const exists = await fs
        .access(BORN_DIGITAL_PDF)
        .then(() => true)
        .catch(() => false)
      if (!exists) {
        console.log('Skipping test: born-digital.pdf not found')
        return
      }

      const doc = await pdfPlugin.load(BORN_DIGITAL_PDF)

      try {
        const { units } = await pdfPlugin.parse(doc)
        const analyzed = await pdfPlugin.analyzeUnit(units[0], doc)
        analyzed.kind = pdfPlugin.classifyUnit(analyzed)

        const result = await pdfPlugin.extractUnit(analyzed, doc)

        expect(result.text).toBeDefined()
        expect(result.charCount).toBeGreaterThanOrEqual(0)
        expect(result.extraction.method).toBe('digital')
        expect(result.extraction.reliability).toBe('exact')
      } finally {
        await pdfPlugin.cleanup?.(doc)
      }
    })
  })

  describe('renderUnit', () => {
    it('renders page to image', async () => {
      const exists = await fs
        .access(BORN_DIGITAL_PDF)
        .then(() => true)
        .catch(() => false)
      if (!exists) {
        console.log('Skipping test: born-digital.pdf not found')
        return
      }

      const doc = await pdfPlugin.load(BORN_DIGITAL_PDF)

      try {
        const { units } = await pdfPlugin.parse(doc)
        const rendered = await pdfPlugin.renderUnit?.(units[0], doc, { scale: 1 })

        expect(rendered).toBeDefined()
        expect(rendered?.base64).toBeDefined()
        expect(rendered?.base64?.length).toBeGreaterThan(0)
        expect(rendered?.mimeType).toBe('image/png')
        expect(rendered?.width).toBeGreaterThan(0)
        expect(rendered?.height).toBeGreaterThan(0)
      } finally {
        await pdfPlugin.cleanup?.(doc)
      }
    })
  })

  describe('getCliOptions', () => {
    it('returns CLI options', () => {
      const options = pdfPlugin.getCliOptions?.()

      expect(options).toBeDefined()
      expect(options?.length).toBeGreaterThan(0)
      expect(options?.some((o) => o.flags.includes('--ocr-lang'))).toBe(true)
      expect(options?.some((o) => o.flags.includes('--page-timeout'))).toBe(true)
    })
  })
})

describe('pdfPlugin integration', () => {
  it('full extraction pipeline', async () => {
    const exists = await fs
      .access(BORN_DIGITAL_PDF)
      .then(() => true)
      .catch(() => false)
    if (!exists) {
      console.log('Skipping test: born-digital.pdf not found')
      return
    }

    const doc = await pdfPlugin.load(BORN_DIGITAL_PDF)

    try {
      // Parse
      const { units } = await pdfPlugin.parse(doc)
      expect(units.length).toBeGreaterThan(0)

      // Analyze and classify all units
      const analyzed: PdfUnit[] = []
      for (const unit of units) {
        const a = await pdfPlugin.analyzeUnit(unit, doc)
        a.kind = pdfPlugin.classifyUnit(a)
        analyzed.push(a)
      }

      // Extract from first unit
      const result = await pdfPlugin.extractUnit(analyzed[0], doc)
      expect(result.text.length).toBeGreaterThan(0)
    } finally {
      await pdfPlugin.cleanup?.(doc)
    }
  })
})
