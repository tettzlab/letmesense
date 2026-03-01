import fs from 'node:fs/promises'
import path from 'node:path'

import { officePlugin } from './plugin.js'
import type { OfficeLoadedDocument, OfficeUnit } from './types.js'

// Test sample paths
const SAMPLES_DIR = path.resolve(import.meta.dirname, '../../../samples')
const SAMPLE_DOCX = path.join(SAMPLES_DIR, 'sample.docx')
const SAMPLE_PPTX = path.join(SAMPLES_DIR, 'sample.pptx')
const SAMPLE_XLSX = path.join(SAMPLES_DIR, 'sample.xlsx')

async function fileExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false)
}

describe('officePlugin', () => {
  describe('identity', () => {
    it('has correct id', () => {
      expect(officePlugin.id).toBe('docx')
    })

    it('has correct extensions', () => {
      expect(officePlugin.extensions).toContain('.docx')
      expect(officePlugin.extensions).toContain('.pptx')
      expect(officePlugin.extensions).toContain('.xlsx')
      expect(officePlugin.extensions).toContain('.odt')
      expect(officePlugin.extensions).toContain('.odp')
      expect(officePlugin.extensions).toContain('.ods')
    })

    it('has correct mime types', () => {
      expect(officePlugin.mimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      expect(officePlugin.mimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      )
      expect(officePlugin.mimeTypes).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
    })

    it('has correct capabilities', () => {
      expect(officePlugin.capabilities.ocr).toBe(false)
      expect(officePlugin.capabilities.vision).toBe(true) // Uses LibreOffice PDF conversion
      expect(officePlugin.capabilities.parallel).toBe(true)
      expect(officePlugin.capabilities.supportsRuns).toBe(true)
      expect(officePlugin.capabilities.multiUnit).toBe(true)
    })
  })

  describe('load', () => {
    it('loads DOCX from file path', async () => {
      if (!(await fileExists(SAMPLE_DOCX))) {
        console.log('Skipping test: sample.docx not found')
        return
      }

      const doc = await officePlugin.load(SAMPLE_DOCX)
      expect(doc.format).toBe('docx')
      expect(doc.bytes).toBeInstanceOf(Uint8Array)
      expect(doc.bytes.length).toBeGreaterThan(0)
      expect((doc as OfficeLoadedDocument).parsed).toBeDefined()
      expect((doc as OfficeLoadedDocument).officeFormat).toBe('docx')

      await officePlugin.cleanup?.(doc)
    })

    it('loads PPTX from file path', async () => {
      if (!(await fileExists(SAMPLE_PPTX))) {
        console.log('Skipping test: sample.pptx not found')
        return
      }

      const doc = await officePlugin.load(SAMPLE_PPTX)
      expect(doc.format).toBe('pptx')
      expect((doc as OfficeLoadedDocument).officeFormat).toBe('pptx')

      await officePlugin.cleanup?.(doc)
    })

    it('loads XLSX from file path', async () => {
      if (!(await fileExists(SAMPLE_XLSX))) {
        console.log('Skipping test: sample.xlsx not found')
        return
      }

      const doc = await officePlugin.load(SAMPLE_XLSX)
      expect(doc.format).toBe('xlsx')
      expect((doc as OfficeLoadedDocument).officeFormat).toBe('xlsx')

      await officePlugin.cleanup?.(doc)
    })

    it('rejects invalid input', async () => {
      await expect(officePlugin.load(123 as unknown as string)).rejects.toThrow()
    })
  })

  describe('classifyUnit', () => {
    it('classifies text-only unit', () => {
      const unit: OfficeUnit = {
        index: 0,
        label: 'Section 1',
        kind: 'unknown',
        charCount: 1000,
        language: 'eng',
        textSample: 'Lorem ipsum...',
        unitLabel: 'Section 1',
        imageCount: 0,
        officeKind: 'text-only',
      }

      const kind = officePlugin.classifyUnit(unit)
      expect(kind).toBe('text-only')
    })

    it('classifies image-only unit', () => {
      const unit: OfficeUnit = {
        index: 0,
        label: 'Slide 1',
        kind: 'unknown',
        charCount: 10,
        language: 'und',
        textSample: '',
        unitLabel: 'Slide 1',
        imageCount: 5,
        officeKind: 'image-only',
      }

      const kind = officePlugin.classifyUnit(unit)
      expect(kind).toBe('image-only')
    })

    it('classifies mixed unit', () => {
      const unit: OfficeUnit = {
        index: 0,
        label: 'Slide 2',
        kind: 'unknown',
        charCount: 500,
        language: 'eng',
        textSample: 'Text content...',
        unitLabel: 'Slide 2',
        imageCount: 3,
        officeKind: 'mixed',
      }

      const kind = officePlugin.classifyUnit(unit)
      expect(kind).toBe('mixed')
    })

    it('classifies empty unit', () => {
      const unit: OfficeUnit = {
        index: 0,
        label: 'Slide 3',
        kind: 'unknown',
        charCount: 0,
        language: 'und',
        textSample: '',
        unitLabel: 'Slide 3',
        imageCount: 0,
        officeKind: 'empty',
      }

      const kind = officePlugin.classifyUnit(unit)
      expect(kind).toBe('empty')
    })
  })

  describe('buildRunKey', () => {
    it('builds run key from unit attributes', () => {
      const unit: OfficeUnit = {
        index: 0,
        label: 'Section 1',
        kind: 'text-only',
        charCount: 1000,
        language: 'eng',
        textSample: 'Lorem ipsum...',
        unitLabel: 'Section 1',
        imageCount: 0,
        officeKind: 'text-only',
      }

      const key = officePlugin.buildRunKey?.(unit)
      expect(key).toBe('text-only|eng')
    })
  })

  describe('getCliOptions', () => {
    it('returns CLI options', () => {
      const options = officePlugin.getCliOptions?.()

      expect(options).toBeDefined()
      expect(options?.length).toBeGreaterThan(0)
      expect(options?.some((o) => o.flags.includes('--include-notes'))).toBe(true)
      expect(options?.some((o) => o.flags.includes('--slide-range'))).toBe(true)
      expect(options?.some((o) => o.flags.includes('--sheet-names'))).toBe(true)
      expect(options?.some((o) => o.flags.includes('--headers'))).toBe(true)
    })
  })
})

describe('officePlugin integration', () => {
  it('full extraction pipeline for DOCX', async () => {
    if (!(await fileExists(SAMPLE_DOCX))) {
      console.log('Skipping test: sample.docx not found')
      return
    }

    const doc = await officePlugin.load(SAMPLE_DOCX)

    try {
      // Parse
      const { units } = await officePlugin.parse(doc)
      expect(units.length).toBeGreaterThan(0)

      // Analyze first unit
      const analyzed = await officePlugin.analyzeUnit(units[0], doc)
      analyzed.kind = officePlugin.classifyUnit(analyzed)

      expect(['text-only', 'image-only', 'mixed', 'empty', 'unknown']).toContain(analyzed.kind)

      // Extract from first unit
      const result = await officePlugin.extractUnit(analyzed, doc)
      expect(result.text).toBeDefined()
      expect(result.extraction.method).toBe('digital')
    } finally {
      await officePlugin.cleanup?.(doc)
    }
  })

  it('full extraction pipeline for PPTX', async () => {
    if (!(await fileExists(SAMPLE_PPTX))) {
      console.log('Skipping test: sample.pptx not found')
      return
    }

    const doc = await officePlugin.load(SAMPLE_PPTX)

    try {
      const { units } = await officePlugin.parse(doc)
      expect(units.length).toBeGreaterThan(0)

      // First unit should be labeled as "Slide 1"
      expect(units[0].label).toMatch(/Slide/)

      const analyzed = await officePlugin.analyzeUnit(units[0], doc)
      expect(analyzed.slideNumber).toBe(1)
    } finally {
      await officePlugin.cleanup?.(doc)
    }
  })

  it('full extraction pipeline for XLSX', async () => {
    if (!(await fileExists(SAMPLE_XLSX))) {
      console.log('Skipping test: sample.xlsx not found')
      return
    }

    const doc = await officePlugin.load(SAMPLE_XLSX)

    try {
      const { units } = await officePlugin.parse(doc)
      expect(units.length).toBeGreaterThan(0)

      // First unit should be labeled as "Sheet: ..."
      expect(units[0].label).toMatch(/Sheet/)

      const analyzed = await officePlugin.analyzeUnit(units[0], doc)
      expect(analyzed.sheetName).toBeDefined()
    } finally {
      await officePlugin.cleanup?.(doc)
    }
  })
})
