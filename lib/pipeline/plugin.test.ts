import { describe, expect, it, vi } from 'vitest'
import type { FormatPlugin } from './plugin.js'
import { buildRuns, canRender, defaultBuildRunKey, supportsOcr, supportsVision } from './plugin.js'
import type { ContentKind, DocumentUnit } from './types.js'

// Helper to create a mock unit
function createUnit(
  index: number,
  kind: ContentKind = 'text-only',
  language = 'eng',
): DocumentUnit {
  return {
    index,
    label: `Unit ${index}`,
    kind,
    charCount: 100,
    language,
    textSample: 'Sample text',
  }
}

// Helper to create a mock plugin
function createMockPlugin(overrides: Partial<FormatPlugin> = {}): FormatPlugin {
  return {
    id: 'pdf',
    name: 'PDF Plugin',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
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
    ...overrides,
  }
}

describe('defaultBuildRunKey', () => {
  it('builds key from kind and language', () => {
    const unit = createUnit(0, 'text-only', 'eng')
    expect(defaultBuildRunKey(unit)).toBe('text-only|eng')
  })

  it('handles different kinds', () => {
    expect(defaultBuildRunKey(createUnit(0, 'image-only', 'jpn'))).toBe('image-only|jpn')
    expect(defaultBuildRunKey(createUnit(0, 'mixed', 'deu'))).toBe('mixed|deu')
    expect(defaultBuildRunKey(createUnit(0, 'empty', 'und'))).toBe('empty|und')
  })
})

describe('buildRuns', () => {
  it('groups consecutive units with same key', () => {
    const units = [
      createUnit(0, 'text-only', 'eng'),
      createUnit(1, 'text-only', 'eng'),
      createUnit(2, 'text-only', 'eng'),
    ]

    const runs = buildRuns(units)
    expect(runs).toHaveLength(1)
    expect(runs[0].key).toBe('text-only|eng')
    expect(runs[0].unitIndices).toEqual([0, 1, 2])
    expect(runs[0].units).toHaveLength(3)
  })

  it('splits at kind boundaries', () => {
    const units = [
      createUnit(0, 'text-only', 'eng'),
      createUnit(1, 'image-only', 'eng'),
      createUnit(2, 'text-only', 'eng'),
    ]

    const runs = buildRuns(units)
    expect(runs).toHaveLength(3)
    expect(runs[0].kind).toBe('text-only')
    expect(runs[1].kind).toBe('image-only')
    expect(runs[2].kind).toBe('text-only')
  })

  it('splits at language boundaries', () => {
    const units = [
      createUnit(0, 'text-only', 'eng'),
      createUnit(1, 'text-only', 'jpn'),
      createUnit(2, 'text-only', 'eng'),
    ]

    const runs = buildRuns(units)
    expect(runs).toHaveLength(3)
    expect(runs[0].language).toBe('eng')
    expect(runs[1].language).toBe('jpn')
    expect(runs[2].language).toBe('eng')
  })

  it('handles empty units array', () => {
    const runs = buildRuns([])
    expect(runs).toEqual([])
  })

  it('handles single unit', () => {
    const units = [createUnit(0)]
    const runs = buildRuns(units)
    expect(runs).toHaveLength(1)
    expect(runs[0].unitIndices).toEqual([0])
  })

  it('uses custom key function', () => {
    const units = [
      createUnit(0, 'text-only', 'eng'),
      createUnit(1, 'text-only', 'eng'),
      createUnit(2, 'text-only', 'eng'),
    ]

    // Custom key function that only uses kind
    const customKey = (unit: DocumentUnit) => unit.kind
    const runs = buildRuns(units, customKey)
    expect(runs).toHaveLength(1)
    expect(runs[0].key).toBe('text-only')
  })

  it('creates individual runs when key function returns null', () => {
    const units = [
      createUnit(0, 'text-only', 'eng'),
      createUnit(1, 'text-only', 'eng'),
      createUnit(2, 'text-only', 'eng'),
    ]

    // Key function that returns null (no grouping)
    const runs = buildRuns(units, () => null)
    expect(runs).toHaveLength(3)
    expect(runs[0].key).toBe('unit-0')
    expect(runs[1].key).toBe('unit-1')
    expect(runs[2].key).toBe('unit-2')
  })

  it('preserves unit references in runs', () => {
    const units = [createUnit(0), createUnit(1)]
    const runs = buildRuns(units)
    expect(runs[0].units?.[0]).toBe(units[0])
    expect(runs[0].units?.[1]).toBe(units[1])
  })
})

describe('canRender', () => {
  it('returns true when plugin has renderUnit', () => {
    const plugin = createMockPlugin({
      renderUnit: vi.fn(),
    })
    expect(canRender(plugin)).toBe(true)
  })

  it('returns false when plugin lacks renderUnit', () => {
    const plugin = createMockPlugin()
    expect(canRender(plugin)).toBe(false)
  })
})

describe('supportsOcr', () => {
  it('returns true when plugin has ocr capability and renderUnit', () => {
    const plugin = createMockPlugin({
      capabilities: {
        ocr: true,
        vision: false,
        streaming: false,
        parallel: true,
        supportsRuns: true,
        multiUnit: true,
      },
      renderUnit: vi.fn(),
    })
    expect(supportsOcr(plugin)).toBe(true)
  })

  it('returns false when plugin has ocr capability but no renderUnit', () => {
    const plugin = createMockPlugin({
      capabilities: {
        ocr: true,
        vision: false,
        streaming: false,
        parallel: true,
        supportsRuns: true,
        multiUnit: true,
      },
    })
    expect(supportsOcr(plugin)).toBe(false)
  })

  it('returns false when plugin lacks ocr capability', () => {
    const plugin = createMockPlugin({
      renderUnit: vi.fn(),
    })
    expect(supportsOcr(plugin)).toBe(false)
  })
})

describe('supportsVision', () => {
  it('returns true when plugin has vision capability and renderUnit', () => {
    const plugin = createMockPlugin({
      capabilities: {
        ocr: false,
        vision: true,
        streaming: false,
        parallel: true,
        supportsRuns: true,
        multiUnit: true,
      },
      renderUnit: vi.fn(),
    })
    expect(supportsVision(plugin)).toBe(true)
  })

  it('returns false when plugin has vision capability but no renderUnit', () => {
    const plugin = createMockPlugin({
      capabilities: {
        ocr: false,
        vision: true,
        streaming: false,
        parallel: true,
        supportsRuns: true,
        multiUnit: true,
      },
    })
    expect(supportsVision(plugin)).toBe(false)
  })

  it('returns false when plugin lacks vision capability', () => {
    const plugin = createMockPlugin({
      renderUnit: vi.fn(),
    })
    expect(supportsVision(plugin)).toBe(false)
  })
})
