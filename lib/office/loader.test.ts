import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OfficeLoadError } from './errors.js'
import {
  detectFormatFromBytes,
  detectFormatFromExtension,
  detectFormatFromMime,
  detectInputType,
  getSupportedExtensions,
  getSupportedFormats,
  isSupportedFormat,
  loadOfficeDocument,
} from './loader.js'

describe('detectInputType', () => {
  it('detects Buffer as bytes', () => {
    expect(detectInputType(Buffer.from('test'))).toBe('bytes')
  })

  it('detects Uint8Array as bytes', () => {
    expect(detectInputType(new Uint8Array([1, 2, 3]))).toBe('bytes')
  })

  it('detects http URL as url', () => {
    expect(detectInputType('http://example.com/doc.docx')).toBe('url')
  })

  it('detects https URL as url', () => {
    expect(detectInputType('https://example.com/doc.docx')).toBe('url')
  })

  it('detects file path as file', () => {
    expect(detectInputType('/path/to/document.docx')).toBe('file')
  })

  it('detects relative path as file', () => {
    expect(detectInputType('./document.xlsx')).toBe('file')
  })

  it('detects Windows path as file', () => {
    expect(detectInputType('C:\\Users\\doc.pptx')).toBe('file')
  })

  it('throws for invalid input type', () => {
    expect(() => detectInputType(123 as any)).toThrow(OfficeLoadError)
  })
})

describe('detectFormatFromExtension', () => {
  it('detects .docx', () => {
    expect(detectFormatFromExtension('/path/to/file.docx')).toBe('docx')
  })

  it('detects .pptx', () => {
    expect(detectFormatFromExtension('presentation.pptx')).toBe('pptx')
  })

  it('detects .xlsx', () => {
    expect(detectFormatFromExtension('spreadsheet.xlsx')).toBe('xlsx')
  })

  it('detects .odt', () => {
    expect(detectFormatFromExtension('document.odt')).toBe('odt')
  })

  it('detects .odp', () => {
    expect(detectFormatFromExtension('slides.odp')).toBe('odp')
  })

  it('detects .ods', () => {
    expect(detectFormatFromExtension('data.ods')).toBe('ods')
  })

  it('is case insensitive', () => {
    expect(detectFormatFromExtension('FILE.DOCX')).toBe('docx')
    expect(detectFormatFromExtension('FILE.Pptx')).toBe('pptx')
  })

  it('returns null for unsupported extension', () => {
    expect(detectFormatFromExtension('file.pdf')).toBeNull()
    expect(detectFormatFromExtension('file.txt')).toBeNull()
    expect(detectFormatFromExtension('file.doc')).toBeNull() // Old format
  })

  it('returns null for no extension', () => {
    expect(detectFormatFromExtension('filename')).toBeNull()
  })
})

describe('detectFormatFromMime', () => {
  it('detects DOCX MIME type', () => {
    expect(
      detectFormatFromMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('docx')
  })

  it('detects PPTX MIME type', () => {
    expect(
      detectFormatFromMime(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe('pptx')
  })

  it('detects XLSX MIME type', () => {
    expect(
      detectFormatFromMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('xlsx')
  })

  it('detects ODT MIME type', () => {
    expect(detectFormatFromMime('application/vnd.oasis.opendocument.text')).toBe('odt')
  })

  it('detects ODP MIME type', () => {
    expect(detectFormatFromMime('application/vnd.oasis.opendocument.presentation')).toBe('odp')
  })

  it('detects ODS MIME type', () => {
    expect(detectFormatFromMime('application/vnd.oasis.opendocument.spreadsheet')).toBe('ods')
  })

  it('returns null for unknown MIME type', () => {
    expect(detectFormatFromMime('application/pdf')).toBeNull()
    expect(detectFormatFromMime('text/plain')).toBeNull()
  })
})

describe('detectFormatFromBytes', () => {
  it('returns null for non-ZIP bytes', () => {
    expect(detectFormatFromBytes(Buffer.from('not a zip file'))).toBeNull()
  })

  it('returns null for bytes shorter than 4', () => {
    expect(detectFormatFromBytes(Buffer.from([0x50, 0x4b]))).toBeNull()
  })

  it('returns null for ZIP bytes (cannot determine specific format)', () => {
    // ZIP magic bytes: PK\x03\x04
    const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
    expect(detectFormatFromBytes(zipBytes)).toBeNull()
  })
})

describe('isSupportedFormat', () => {
  it('returns true for supported extensions', () => {
    expect(isSupportedFormat('file.docx')).toBe(true)
    expect(isSupportedFormat('file.pptx')).toBe(true)
    expect(isSupportedFormat('file.xlsx')).toBe(true)
    expect(isSupportedFormat('file.odt')).toBe(true)
    expect(isSupportedFormat('file.odp')).toBe(true)
    expect(isSupportedFormat('file.ods')).toBe(true)
  })

  it('returns false for unsupported extensions', () => {
    expect(isSupportedFormat('file.pdf')).toBe(false)
    expect(isSupportedFormat('file.doc')).toBe(false)
    expect(isSupportedFormat('file.xls')).toBe(false)
  })

  it('works with full paths', () => {
    expect(isSupportedFormat('/path/to/file.docx')).toBe(true)
    expect(isSupportedFormat('https://example.com/file.pptx')).toBe(true)
  })
})

describe('getSupportedExtensions', () => {
  it('returns all supported extensions', () => {
    const extensions = getSupportedExtensions()
    expect(extensions).toContain('.docx')
    expect(extensions).toContain('.pptx')
    expect(extensions).toContain('.xlsx')
    expect(extensions).toContain('.odt')
    expect(extensions).toContain('.odp')
    expect(extensions).toContain('.ods')
  })

  it('returns array of 6 extensions', () => {
    expect(getSupportedExtensions()).toHaveLength(6)
  })
})

describe('getSupportedFormats', () => {
  it('returns all supported formats', () => {
    const formats = getSupportedFormats()
    expect(formats).toContain('docx')
    expect(formats).toContain('pptx')
    expect(formats).toContain('xlsx')
    expect(formats).toContain('odt')
    expect(formats).toContain('odp')
    expect(formats).toContain('ods')
  })

  it('returns unique formats', () => {
    const formats = getSupportedFormats()
    expect(new Set(formats).size).toBe(formats.length)
  })
})

describe('loadOfficeDocument', () => {
  let tmpDir: string
  let testDocx: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loader-test-'))

    // Create a minimal valid DOCX (it's a ZIP file)
    // We'll create a mock file that has .docx extension
    testDocx = path.join(tmpDir, 'test.docx')
    // ZIP magic bytes + some content
    const zipHeader = Buffer.from([
      0x50,
      0x4b,
      0x03,
      0x04, // ZIP magic
      0x14,
      0x00,
      0x00,
      0x00, // Version needed
      0x08,
      0x00, // Compression method
      0x00,
      0x00,
      0x00,
      0x00, // File time/date
      0x00,
      0x00,
      0x00,
      0x00, // CRC
      0x00,
      0x00,
      0x00,
      0x00, // Compressed size
      0x00,
      0x00,
      0x00,
      0x00, // Uncompressed size
    ])
    await fs.writeFile(testDocx, zipHeader)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('from file', () => {
    it('loads file and detects format from extension', async () => {
      const result = await loadOfficeDocument(testDocx)
      expect(result.format).toBe('docx')
      expect(result.source).toBe(testDocx)
      expect(Buffer.isBuffer(result.bytes)).toBe(true)
    })

    it('throws for non-existent file', async () => {
      await expect(loadOfficeDocument('/non/existent/file.docx')).rejects.toThrow(OfficeLoadError)
      await expect(loadOfficeDocument('/non/existent/file.docx')).rejects.toThrow('File not found')
    })

    it('throws for unsupported extension', async () => {
      const unsupportedFile = path.join(tmpDir, 'test.pdf')
      await fs.writeFile(unsupportedFile, 'test')

      await expect(loadOfficeDocument(unsupportedFile)).rejects.toThrow(OfficeLoadError)
      await expect(loadOfficeDocument(unsupportedFile)).rejects.toThrow(
        'Unsupported file extension',
      )
    })
  })

  describe('from buffer', () => {
    it('loads buffer when format specified', async () => {
      const buffer = Buffer.from('test data')
      const result = await loadOfficeDocument(buffer, { format: 'xlsx' })

      expect(result.format).toBe('xlsx')
      expect(result.source).toBe('buffer')
      expect(result.bytes).toEqual(buffer)
    })

    it('converts Uint8Array to Buffer', async () => {
      const uint8 = new Uint8Array([1, 2, 3, 4])
      const result = await loadOfficeDocument(uint8, { format: 'pptx' })

      expect(result.format).toBe('pptx')
      expect(Buffer.isBuffer(result.bytes)).toBe(true)
      expect([...result.bytes]).toEqual([1, 2, 3, 4])
    })

    it('throws when format not specified for buffer', async () => {
      const buffer = Buffer.from('test data')

      await expect(loadOfficeDocument(buffer)).rejects.toThrow(OfficeLoadError)
      await expect(loadOfficeDocument(buffer)).rejects.toThrow('Format must be specified')
    })
  })

  describe('from URL', () => {
    it('throws when URL fetch fails', async () => {
      // Mock fetch to fail
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

      try {
        await expect(loadOfficeDocument('https://example.com/doc.docx')).rejects.toThrow(
          OfficeLoadError,
        )
      } finally {
        global.fetch = originalFetch
      }
    })

    it('throws when HTTP status is not ok', async () => {
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      try {
        await expect(loadOfficeDocument('https://example.com/doc.docx')).rejects.toThrow('HTTP 404')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('detects format from Content-Type header', async () => {
      const originalFetch = global.fetch
      const mockArrayBuffer = new ArrayBuffer(10)
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      try {
        const result = await loadOfficeDocument('https://example.com/document')
        expect(result.format).toBe('docx')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('falls back to URL extension when Content-Type not recognized', async () => {
      const originalFetch = global.fetch
      const mockArrayBuffer = new ArrayBuffer(10)
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      try {
        const result = await loadOfficeDocument('https://example.com/file.xlsx')
        expect(result.format).toBe('xlsx')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('throws when format cannot be detected from URL', async () => {
      const originalFetch = global.fetch
      const mockArrayBuffer = new ArrayBuffer(10)
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'content-type': 'application/octet-stream',
        }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      })

      try {
        await expect(loadOfficeDocument('https://example.com/unknown')).rejects.toThrow(
          'Could not detect format',
        )
      } finally {
        global.fetch = originalFetch
      }
    })

    it('respects timeout option', async () => {
      const originalFetch = global.fetch
      let capturedSignal: AbortSignal | undefined

      global.fetch = vi.fn().mockImplementation((_url, options) => {
        capturedSignal = options?.signal
        return Promise.resolve({
          ok: true,
          headers: new Headers({
            'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
        })
      })

      try {
        await loadOfficeDocument('https://example.com/file.xlsx', { timeout: 5000 })
        expect(capturedSignal).toBeDefined()
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})
