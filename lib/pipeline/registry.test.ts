import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormatPlugin } from './plugin.js'
import {
  describeSource,
  detectFormatFromBytes,
  detectFormatFromExtension,
  detectFormatFromMime,
  getDefaultRegistry,
  getExtension,
  getPlugin,
  PluginRegistry,
  registerPlugin,
  resetDefaultRegistry,
} from './registry.js'

// Helper to create a mock plugin
function createMockPlugin(
  id: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'image',
  extensions: string[],
  mimeTypes: string[],
): FormatPlugin {
  return {
    id,
    name: `${id.toUpperCase()} Plugin`,
    extensions,
    mimeTypes,
    capabilities: {
      ocr: false,
      vision: false,
      streaming: false,
      parallel: true,
      supportsRuns: true,
      multiUnit: true,
    },
    load: vi.fn(),
    parse: vi.fn(),
    analyzeUnit: vi.fn(),
    classifyUnit: vi.fn(),
    extractUnit: vi.fn(),
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry

  beforeEach(() => {
    registry = new PluginRegistry()
  })

  describe('register', () => {
    it('registers a plugin', () => {
      const plugin = createMockPlugin('pdf', ['.pdf'], ['application/pdf'])
      registry.register(plugin)
      expect(registry.has('pdf')).toBe(true)
    })

    it('overwrites existing plugin with same ID', () => {
      const plugin1 = createMockPlugin('pdf', ['.pdf'], ['application/pdf'])
      const plugin2 = createMockPlugin('pdf', ['.pdf', '.PDF'], ['application/pdf'])
      registry.register(plugin1)
      registry.register(plugin2)
      const retrieved = registry.get('pdf')
      expect(retrieved?.extensions).toContain('.PDF')
    })
  })

  describe('get', () => {
    it('returns plugin by ID', () => {
      const plugin = createMockPlugin('pdf', ['.pdf'], ['application/pdf'])
      registry.register(plugin)
      expect(registry.get('pdf')).toBe(plugin)
    })

    it('returns undefined for unknown ID', () => {
      expect(registry.get('pdf')).toBeUndefined()
    })
  })

  describe('has', () => {
    it('returns true for registered format', () => {
      const plugin = createMockPlugin('pdf', ['.pdf'], ['application/pdf'])
      registry.register(plugin)
      expect(registry.has('pdf')).toBe(true)
    })

    it('returns false for unregistered format', () => {
      expect(registry.has('pdf')).toBe(false)
    })
  })

  describe('getByExtension', () => {
    it('returns plugin by extension', () => {
      const plugin = createMockPlugin('pdf', ['.pdf', '.PDF'], ['application/pdf'])
      registry.register(plugin)
      expect(registry.getByExtension('.pdf')).toBe(plugin)
    })

    it('is case-insensitive', () => {
      const plugin = createMockPlugin('pdf', ['.pdf'], ['application/pdf'])
      registry.register(plugin)
      expect(registry.getByExtension('.PDF')).toBe(plugin)
    })

    it('returns undefined for unknown extension', () => {
      expect(registry.getByExtension('.xyz')).toBeUndefined()
    })
  })

  describe('getByMimeType', () => {
    it('returns plugin by MIME type', () => {
      const plugin = createMockPlugin('pdf', ['.pdf'], ['application/pdf'])
      registry.register(plugin)
      expect(registry.getByMimeType('application/pdf')).toBe(plugin)
    })

    it('is case-insensitive', () => {
      const plugin = createMockPlugin('pdf', ['.pdf'], ['application/pdf'])
      registry.register(plugin)
      expect(registry.getByMimeType('Application/PDF')).toBe(plugin)
    })

    it('returns undefined for unknown MIME type', () => {
      expect(registry.getByMimeType('application/unknown')).toBeUndefined()
    })
  })

  describe('detectFormat', () => {
    beforeEach(() => {
      registry.register(createMockPlugin('pdf', ['.pdf'], ['application/pdf']))
      registry.register(
        createMockPlugin(
          'docx',
          ['.docx'],
          ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        ),
      )
    })

    it('uses explicit format when provided', () => {
      const result = registry.detectFormat('/path/to/file.unknown', { format: 'pdf' })
      expect(result?.format).toBe('pdf')
    })

    it('detects format from file extension', () => {
      const result = registry.detectFormat('/path/to/file.pdf')
      expect(result?.format).toBe('pdf')
    })

    it('detects format from URL extension', () => {
      const result = registry.detectFormat('https://example.com/document.pdf')
      expect(result?.format).toBe('pdf')
    })

    it('detects format from URL object', () => {
      const url = new URL('https://example.com/document.pdf')
      const result = registry.detectFormat(url)
      expect(result?.format).toBe('pdf')
    })

    it('detects format from MIME type', () => {
      const result = registry.detectFormat('/path/unknown', { mimeType: 'application/pdf' })
      expect(result?.format).toBe('pdf')
    })

    it('detects format from magic bytes', () => {
      // PDF magic bytes: %PDF
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
      const result = registry.detectFormat(bytes)
      expect(result?.format).toBe('pdf')
    })

    it('returns null when format cannot be detected', () => {
      const result = registry.detectFormat('/path/unknown')
      expect(result).toBeNull()
    })

    it('returns null for unknown buffer content', () => {
      const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00])
      const result = registry.detectFormat(bytes)
      expect(result).toBeNull()
    })
  })

  describe('getAllFormats', () => {
    it('returns all registered format IDs', () => {
      registry.register(createMockPlugin('pdf', ['.pdf'], []))
      registry.register(createMockPlugin('docx', ['.docx'], []))
      const formats = registry.getAllFormats()
      expect(formats).toContain('pdf')
      expect(formats).toContain('docx')
    })
  })

  describe('getAllPlugins', () => {
    it('returns all registered plugins', () => {
      const pdf = createMockPlugin('pdf', ['.pdf'], [])
      const docx = createMockPlugin('docx', ['.docx'], [])
      registry.register(pdf)
      registry.register(docx)
      const plugins = registry.getAllPlugins()
      expect(plugins).toContain(pdf)
      expect(plugins).toContain(docx)
    })
  })
})

describe('getExtension', () => {
  it('extracts extension from file path', () => {
    expect(getExtension('/path/to/file.pdf')).toBe('.pdf')
  })

  it('extracts extension from filename', () => {
    expect(getExtension('document.docx')).toBe('.docx')
  })

  it('extracts extension from URL', () => {
    expect(getExtension('https://example.com/file.pdf')).toBe('.pdf')
  })

  it('extracts extension from URL with query string', () => {
    expect(getExtension('https://example.com/file.pdf?token=abc')).toBe('.pdf')
  })

  it('extracts extension from URL with fragment', () => {
    expect(getExtension('https://example.com/file.pdf#page=1')).toBe('.pdf')
  })

  it('returns lowercase extension', () => {
    expect(getExtension('/path/to/FILE.PDF')).toBe('.pdf')
  })

  it('returns null for path without extension', () => {
    expect(getExtension('/path/to/file')).toBeNull()
  })

  it('returns null for dotfile without extension', () => {
    expect(getExtension('/path/to/.gitignore')).toBe('.gitignore')
  })

  it('handles Windows-style paths', () => {
    expect(getExtension('C:\\path\\to\\file.pdf')).toBe('.pdf')
  })
})

describe('detectFormatFromBytes', () => {
  it('detects PDF from magic bytes', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // %PDF
    expect(detectFormatFromBytes(bytes)).toBe('pdf')
  })

  it('detects ZIP-based format from magic bytes', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]) // PK
    expect(detectFormatFromBytes(bytes)).toBe('docx') // Default for ZIP
  })

  it('detects PNG from magic bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(detectFormatFromBytes(bytes)).toBe('image')
  })

  it('detects JPEG from magic bytes', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(detectFormatFromBytes(bytes)).toBe('image')
  })

  it('detects GIF from magic bytes', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38]) // GIF8
    expect(detectFormatFromBytes(bytes)).toBe('image')
  })

  it('detects WebP from magic bytes (RIFF + WEBP marker)', () => {
    // WebP: RIFF....WEBP (where .... is file size)
    const bytes = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00, // file size (placeholder)
      0x57,
      0x45,
      0x42,
      0x50, // WEBP
    ])
    expect(detectFormatFromBytes(bytes)).toBe('image')
  })

  it('does not detect non-WebP RIFF files as image', () => {
    // WAV: RIFF....WAVE
    const wavBytes = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00, // file size (placeholder)
      0x57,
      0x41,
      0x56,
      0x45, // WAVE (not WEBP)
    ])
    expect(detectFormatFromBytes(wavBytes)).toBeNull()

    // AVI: RIFF....AVI
    const aviBytes = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00, // file size (placeholder)
      0x41,
      0x56,
      0x49,
      0x20, // AVI  (not WEBP)
    ])
    expect(detectFormatFromBytes(aviBytes)).toBeNull()
  })

  it('returns null for unknown bytes', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    expect(detectFormatFromBytes(bytes)).toBeNull()
  })

  it('returns null for empty array', () => {
    const bytes = new Uint8Array([])
    expect(detectFormatFromBytes(bytes)).toBeNull()
  })

  it('returns null for too-short array', () => {
    const bytes = new Uint8Array([0x25, 0x50])
    expect(detectFormatFromBytes(bytes)).toBeNull()
  })
})

describe('detectFormatFromMime', () => {
  it('detects PDF', () => {
    expect(detectFormatFromMime('application/pdf')).toBe('pdf')
  })

  it('detects DOCX', () => {
    expect(
      detectFormatFromMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('docx')
  })

  it('detects PPTX', () => {
    expect(
      detectFormatFromMime(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe('pptx')
  })

  it('detects XLSX', () => {
    expect(
      detectFormatFromMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toBe('xlsx')
  })

  it('detects image formats', () => {
    expect(detectFormatFromMime('image/png')).toBe('image')
    expect(detectFormatFromMime('image/jpeg')).toBe('image')
    expect(detectFormatFromMime('image/gif')).toBe('image')
    expect(detectFormatFromMime('image/webp')).toBe('image')
  })

  it('is case-insensitive', () => {
    expect(detectFormatFromMime('Application/PDF')).toBe('pdf')
  })

  it('returns null for unknown MIME type', () => {
    expect(detectFormatFromMime('application/unknown')).toBeNull()
  })
})

describe('detectFormatFromExtension', () => {
  it('detects common formats', () => {
    expect(detectFormatFromExtension('.pdf')).toBe('pdf')
    expect(detectFormatFromExtension('.docx')).toBe('docx')
    expect(detectFormatFromExtension('.pptx')).toBe('pptx')
    expect(detectFormatFromExtension('.xlsx')).toBe('xlsx')
  })

  it('detects image formats', () => {
    expect(detectFormatFromExtension('.png')).toBe('image')
    expect(detectFormatFromExtension('.jpg')).toBe('image')
    expect(detectFormatFromExtension('.jpeg')).toBe('image')
    expect(detectFormatFromExtension('.gif')).toBe('image')
    expect(detectFormatFromExtension('.webp')).toBe('image')
  })

  it('detects ODF formats', () => {
    expect(detectFormatFromExtension('.odt')).toBe('odt')
    expect(detectFormatFromExtension('.odp')).toBe('odp')
    expect(detectFormatFromExtension('.ods')).toBe('ods')
  })

  it('handles extension without dot', () => {
    expect(detectFormatFromExtension('pdf')).toBe('pdf')
  })

  it('is case-insensitive', () => {
    expect(detectFormatFromExtension('.PDF')).toBe('pdf')
    expect(detectFormatFromExtension('DOCX')).toBe('docx')
  })

  it('returns null for unknown extension', () => {
    expect(detectFormatFromExtension('.xyz')).toBeNull()
  })
})

describe('default registry', () => {
  afterEach(() => {
    resetDefaultRegistry()
  })

  it('getDefaultRegistry returns a registry', () => {
    const registry = getDefaultRegistry()
    expect(registry).toBeInstanceOf(PluginRegistry)
  })

  it('getDefaultRegistry returns same instance', () => {
    const registry1 = getDefaultRegistry()
    const registry2 = getDefaultRegistry()
    expect(registry1).toBe(registry2)
  })

  it('resetDefaultRegistry clears the registry', () => {
    const registry1 = getDefaultRegistry()
    resetDefaultRegistry()
    const registry2 = getDefaultRegistry()
    expect(registry1).not.toBe(registry2)
  })

  it('registerPlugin adds to default registry', () => {
    const plugin = createMockPlugin('pdf', ['.pdf'], ['application/pdf'])
    registerPlugin(plugin)
    expect(getPlugin('pdf')).toBe(plugin)
  })

  it('getPlugin returns undefined for unregistered format', () => {
    expect(getPlugin('pdf')).toBeUndefined()
  })
})

describe('describeSource', () => {
  it('describes file path', () => {
    expect(describeSource('/path/to/document.pdf')).toBe('document.pdf')
  })

  it('describes URL', () => {
    expect(describeSource('https://example.com/file.pdf')).toBe('URL example.com/file.pdf')
  })

  it('describes URL object', () => {
    const url = new URL('https://example.com/file.pdf')
    expect(describeSource(url)).toBe('URL example.com/file.pdf')
  })

  it('describes stdin', () => {
    expect(describeSource('-')).toBe('stdin')
  })

  it('describes buffer with size', () => {
    const buffer = new Uint8Array(1024)
    expect(describeSource(buffer)).toBe('buffer (1024 bytes)')
  })

  it('describes Buffer with size', () => {
    const buffer = Buffer.from([1, 2, 3, 4])
    expect(describeSource(buffer)).toBe('buffer (4 bytes)')
  })

  it('handles URL-like strings', () => {
    // URL with path parsed correctly
    expect(describeSource('https://example.com/path/to/file')).toBe('URL example.com/path/to/file')
    // Short URL-like string shows the filename part
    expect(describeSource('https://example')).toBe('URL example/')
  })
})
