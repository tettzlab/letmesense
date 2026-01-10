import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AbortError, ExtractError, LoadError } from './errors.js'
import type { FormatPlugin, LoadedDocument, ParsedDocument } from './plugin.js'
import { PipelineProcessor } from './processor.js'
import { PluginRegistry } from './registry.js'
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
    name: 'Mock Plugin',
    extensions: ['.mock'],
    mimeTypes: ['application/mock'],
    capabilities: {
      ocr: false,
      vision: false,
      streaming: false,
      parallel: true,
      supportsRuns: true,
      multiUnit: true,
    },
    load: vi.fn().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      format: 'pdf',
    } as LoadedDocument),
    parse: vi.fn().mockResolvedValue({
      units: [createUnit(0), createUnit(1), createUnit(2)],
      metadata: { title: 'Test Document' },
    } as ParsedDocument),
    analyzeUnit: vi.fn().mockImplementation((unit) => Promise.resolve(unit)),
    classifyUnit: vi.fn().mockReturnValue('text-only'),
    extractUnit: vi.fn().mockResolvedValue({
      text: 'Extracted text',
      charCount: 14,
      extraction: { method: 'digital', reliability: 'exact' },
    }),
    buildRunKey: vi.fn().mockImplementation((unit) => `${unit.kind}|${unit.language}`),
    ...overrides,
  }
}

describe('PipelineProcessor', () => {
  let registry: PluginRegistry
  let processor: PipelineProcessor

  beforeEach(() => {
    registry = new PluginRegistry()
    processor = new PipelineProcessor({ registry })
  })

  describe('extract', () => {
    it('extracts text from document', async () => {
      const plugin = createMockPlugin()
      registry.register(plugin)

      const result = await processor.extract('/test/file.mock')

      expect(result.text).toBe('Extracted text\n\nExtracted text\n\nExtracted text')
      expect(result.unitCount).toBe(3)
      expect(result.runCount).toBe(1) // All same kind/language
      expect(result.errors).toHaveLength(0)
    })

    it('includes metadata when requested', async () => {
      const plugin = createMockPlugin()
      registry.register(plugin)

      const result = await processor.extract('/test/file.mock', { includeMetadata: true })

      expect(result.metadata).toEqual({ title: 'Test Document' })
    })

    it('excludes metadata by default', async () => {
      const plugin = createMockPlugin()
      registry.register(plugin)

      const result = await processor.extract('/test/file.mock')

      expect(result.metadata).toBeUndefined()
    })

    it('uses custom separator', async () => {
      const plugin = createMockPlugin()
      registry.register(plugin)

      const result = await processor.extract('/test/file.mock', { separator: '---' })

      expect(result.text).toBe('Extracted text---Extracted text---Extracted text')
    })

    it('throws LoadError when format cannot be detected', async () => {
      await expect(processor.extract('/test/file.unknown')).rejects.toThrow(LoadError)
    })

    it('handles empty document', async () => {
      const plugin = createMockPlugin({
        parse: vi.fn().mockResolvedValue({ units: [] }),
      })
      registry.register(plugin)

      const result = await processor.extract('/test/file.mock')

      expect(result.text).toBe('')
      expect(result.unitCount).toBe(0)
      expect(result.runCount).toBe(0)
    })

    it('emits progress events', async () => {
      const plugin = createMockPlugin()
      registry.register(plugin)

      const events: Array<{ type: string }> = []
      const onProgress = (event: { type: string }) => events.push(event)

      await processor.extract('/test/file.mock', { onProgress })

      const types = events.map((e) => e.type)
      expect(types).toContain('load-start')
      expect(types).toContain('load-done')
      expect(types).toContain('parse-start')
      expect(types).toContain('parse-done')
      expect(types).toContain('analyze-start')
      expect(types).toContain('analyze-done')
      expect(types).toContain('extract-start')
      expect(types).toContain('extract-done')
    })

    it('calls plugin lifecycle methods in order', async () => {
      const callOrder: string[] = []
      const plugin = createMockPlugin({
        load: vi.fn().mockImplementation(() => {
          callOrder.push('load')
          return Promise.resolve({ bytes: new Uint8Array(), format: 'pdf' })
        }),
        parse: vi.fn().mockImplementation(() => {
          callOrder.push('parse')
          return Promise.resolve({ units: [createUnit(0)] })
        }),
        analyzeUnit: vi.fn().mockImplementation((unit) => {
          callOrder.push('analyzeUnit')
          return Promise.resolve(unit)
        }),
        classifyUnit: vi.fn().mockImplementation(() => {
          callOrder.push('classifyUnit')
          return 'text-only'
        }),
        extractUnit: vi.fn().mockImplementation(() => {
          callOrder.push('extractUnit')
          return Promise.resolve({
            text: 'text',
            charCount: 4,
            extraction: { method: 'digital', reliability: 'exact' },
          })
        }),
        cleanup: vi.fn().mockImplementation(() => {
          callOrder.push('cleanup')
          return Promise.resolve()
        }),
      })
      registry.register(plugin)

      await processor.extract('/test/file.mock')

      expect(callOrder).toEqual([
        'load',
        'parse',
        'analyzeUnit',
        'classifyUnit',
        'extractUnit',
        'cleanup',
      ])
    })

    it('calls cleanup even on error', async () => {
      const cleanup = vi.fn()
      const plugin = createMockPlugin({
        parse: vi.fn().mockRejectedValue(new Error('parse error')),
        cleanup,
      })
      registry.register(plugin)

      await expect(processor.extract('/test/file.mock')).rejects.toThrow()
      expect(cleanup).toHaveBeenCalled()
    })

    describe('error handling', () => {
      it('collects non-fatal errors from unit analysis', async () => {
        let callCount = 0
        const plugin = createMockPlugin({
          analyzeUnit: vi.fn().mockImplementation((unit) => {
            callCount++
            if (callCount === 2) {
              return Promise.reject(new Error('analysis failed'))
            }
            return Promise.resolve(unit)
          }),
        })
        registry.register(plugin)

        const result = await processor.extract('/test/file.mock')

        expect(result.errors).toHaveLength(1)
        expect(result.errors[0].phase).toBe('analyze')
        expect(result.errors[0].unitIndex).toBe(1)
      })

      it('throws on first error in strict mode', async () => {
        let callCount = 0
        const plugin = createMockPlugin({
          analyzeUnit: vi.fn().mockImplementation((unit) => {
            callCount++
            if (callCount === 2) {
              return Promise.reject(new Error('analysis failed'))
            }
            return Promise.resolve(unit)
          }),
        })
        registry.register(plugin)

        await expect(processor.extract('/test/file.mock', { strict: true })).rejects.toThrow(
          'Failed to analyze unit 1',
        )
      })

      it('collects errors from failed runs in parallel mode', async () => {
        const plugin = createMockPlugin({
          parse: vi.fn().mockResolvedValue({
            units: [
              createUnit(0, 'text-only', 'eng'),
              createUnit(1, 'image-only', 'eng'), // Different kind = new run
              createUnit(2, 'text-only', 'jpn'), // Different language = new run
            ],
          }),
          classifyUnit: vi.fn().mockImplementation((unit) => unit.kind),
          extractUnit: vi.fn().mockImplementation((unit) => {
            if (unit.index === 1) {
              return Promise.reject(new Error('extraction failed'))
            }
            return Promise.resolve({
              text: 'text',
              charCount: 4,
              extraction: { method: 'digital', reliability: 'exact' },
            })
          }),
        })
        registry.register(plugin)

        const result = await processor.extract('/test/file.mock', { parallel: true })

        // Should have at least one error from the failing unit
        expect(result.errors.length).toBeGreaterThan(0)
        // The error should be for unit 1 which failed extraction
        expect(result.errors.some((e) => e.unitIndex === 1 && e.phase === 'extract')).toBe(true)
      })
    })

    describe('run grouping', () => {
      it('groups consecutive units with same key', async () => {
        const extractUnit = vi.fn().mockResolvedValue({
          text: 'text',
          charCount: 4,
          extraction: { method: 'digital', reliability: 'exact' },
        })
        const plugin = createMockPlugin({
          parse: vi.fn().mockResolvedValue({
            units: [
              createUnit(0, 'text-only', 'eng'),
              createUnit(1, 'text-only', 'eng'),
              createUnit(2, 'text-only', 'eng'),
            ],
          }),
          extractUnit,
        })
        registry.register(plugin)

        const result = await processor.extract('/test/file.mock')

        expect(result.runCount).toBe(1)
        expect(extractUnit).toHaveBeenCalledTimes(3)
      })

      it('creates separate runs for different kinds', async () => {
        const plugin = createMockPlugin({
          parse: vi.fn().mockResolvedValue({
            units: [
              createUnit(0, 'text-only', 'eng'),
              createUnit(1, 'image-only', 'eng'),
              createUnit(2, 'text-only', 'eng'),
            ],
          }),
          classifyUnit: vi.fn().mockImplementation((unit) => unit.kind),
        })
        registry.register(plugin)

        const result = await processor.extract('/test/file.mock')

        expect(result.runCount).toBe(3)
      })

      it('creates separate runs for different languages', async () => {
        const plugin = createMockPlugin({
          parse: vi.fn().mockResolvedValue({
            units: [
              createUnit(0, 'text-only', 'eng'),
              createUnit(1, 'text-only', 'jpn'),
              createUnit(2, 'text-only', 'eng'),
            ],
          }),
        })
        registry.register(plugin)

        const result = await processor.extract('/test/file.mock')

        expect(result.runCount).toBe(3)
      })

      it('uses plugin buildRunKey when provided', async () => {
        const buildRunKey = vi.fn().mockReturnValue('custom-key')
        const plugin = createMockPlugin({ buildRunKey })
        registry.register(plugin)

        await processor.extract('/test/file.mock')

        expect(buildRunKey).toHaveBeenCalled()
      })

      it('falls back to defaultBuildRunKey when plugin lacks buildRunKey', async () => {
        const plugin = createMockPlugin()
        delete plugin.buildRunKey
        registry.register(plugin)

        const result = await processor.extract('/test/file.mock')

        // Should still work with default key function
        expect(result.runCount).toBe(1)
      })
    })

    describe('parallel extraction', () => {
      it('extracts runs in parallel by default', async () => {
        const extractionOrder: number[] = []
        const plugin = createMockPlugin({
          parse: vi.fn().mockResolvedValue({
            units: [
              createUnit(0, 'text-only', 'eng'),
              createUnit(1, 'image-only', 'eng'),
              createUnit(2, 'mixed', 'eng'),
            ],
          }),
          classifyUnit: vi.fn().mockImplementation((unit) => unit.kind),
          extractUnit: vi.fn().mockImplementation(async (unit) => {
            extractionOrder.push(unit.index)
            // Small delay to make parallel vs sequential visible
            await new Promise((resolve) => setTimeout(resolve, 10))
            return {
              text: `text-${unit.index}`,
              charCount: 6,
              extraction: { method: 'digital', reliability: 'exact' },
            }
          }),
        })
        registry.register(plugin)

        await processor.extract('/test/file.mock', { parallel: true })

        // Parallel extraction means order isn't guaranteed
        expect(extractionOrder).toHaveLength(3)
      })

      it('extracts sequentially when parallel is false', async () => {
        const extractionOrder: number[] = []
        const plugin = createMockPlugin({
          parse: vi.fn().mockResolvedValue({
            units: [
              createUnit(0, 'text-only', 'eng'),
              createUnit(1, 'image-only', 'eng'),
              createUnit(2, 'mixed', 'eng'),
            ],
          }),
          classifyUnit: vi.fn().mockImplementation((unit) => unit.kind),
          extractUnit: vi.fn().mockImplementation(async (unit) => {
            extractionOrder.push(unit.index)
            return {
              text: `text-${unit.index}`,
              charCount: 6,
              extraction: { method: 'digital', reliability: 'exact' },
            }
          }),
        })
        registry.register(plugin)

        await processor.extract('/test/file.mock', { parallel: false })

        // Sequential extraction maintains order
        expect(extractionOrder).toEqual([0, 1, 2])
      })

      it('respects plugin parallel capability', async () => {
        const plugin = createMockPlugin({
          capabilities: {
            ocr: false,
            vision: false,
            streaming: false,
            parallel: false, // Disable parallel
            supportsRuns: true,
            multiUnit: true,
          },
        })
        registry.register(plugin)

        // Should still work, just sequentially
        const result = await processor.extract('/test/file.mock', { parallel: true })
        expect(result.text).toBeDefined()
      })
    })
  })

  describe('extractWithVision', () => {
    it('throws when plugin lacks vision capability', async () => {
      const plugin = createMockPlugin()
      registry.register(plugin)

      const gen = processor.extractWithVision('/test/file.mock', { model: 'test:model' })

      await expect(gen.next()).rejects.toThrow(ExtractError)
    })

    it('throws when plugin lacks renderUnit', async () => {
      const plugin = createMockPlugin({
        capabilities: {
          ocr: false,
          vision: true, // Has capability
          streaming: false,
          parallel: true,
          supportsRuns: true,
          multiUnit: true,
        },
        // But no renderUnit method
      })
      registry.register(plugin)

      const gen = processor.extractWithVision('/test/file.mock', { model: 'test:model' })

      await expect(gen.next()).rejects.toThrow(ExtractError)
    })

    it('throws on invalid model spec', async () => {
      const plugin = createMockPlugin({
        capabilities: {
          ocr: true,
          vision: true,
          streaming: false,
          parallel: true,
          supportsRuns: true,
          multiUnit: true,
        },
        parse: vi.fn().mockResolvedValue({
          units: [createUnit(0)],
        }),
        renderUnit: vi.fn().mockResolvedValue({
          base64: 'abc123',
          mimeType: 'image/png',
          width: 100,
          height: 100,
        }),
      })
      registry.register(plugin)

      const gen = processor.extractWithVision('/test/file.mock', {
        model: 'invalid:model',
      })

      // Vision extraction validates model spec and throws for invalid provider
      await expect(gen.next()).rejects.toThrow(/Unknown provider/)
    })

    it('throws on invalid model spec before render', async () => {
      const plugin = createMockPlugin({
        capabilities: {
          ocr: true,
          vision: true,
          streaming: false,
          parallel: true,
          supportsRuns: true,
          multiUnit: true,
        },
        parse: vi.fn().mockResolvedValue({
          units: [createUnit(0)],
        }),
        renderUnit: vi.fn().mockRejectedValue(new Error('render failed')),
      })
      registry.register(plugin)

      // Model validation happens before render, so renderUnit is never called
      const gen = processor.extractWithVision('/test/file.mock', {
        model: 'badprovider:model',
      })

      await expect(gen.next()).rejects.toThrow(/Unknown provider/)
      expect(plugin.renderUnit).not.toHaveBeenCalled()
    })

    it('validates model spec for empty document too', async () => {
      const plugin = createMockPlugin({
        capabilities: {
          ocr: true,
          vision: true,
          streaming: false,
          parallel: true,
          supportsRuns: true,
          multiUnit: true,
        },
        parse: vi.fn().mockResolvedValue({ units: [] }),
        renderUnit: vi.fn(),
      })
      registry.register(plugin)

      // Model validation happens before checking if document is empty
      const gen = processor.extractWithVision('/test/file.mock', {
        model: 'fake:model',
      })

      await expect(gen.next()).rejects.toThrow(/Unknown provider/)
    })

    it('does not call cleanup when model validation fails', async () => {
      const cleanup = vi.fn()
      const plugin = createMockPlugin({
        capabilities: {
          ocr: true,
          vision: true,
          streaming: false,
          parallel: true,
          supportsRuns: true,
          multiUnit: true,
        },
        parse: vi.fn().mockResolvedValue({
          units: [createUnit(0)],
        }),
        renderUnit: vi.fn().mockResolvedValue({
          base64: 'abc123',
          mimeType: 'image/png',
          width: 100,
          height: 100,
        }),
        cleanup,
      })
      registry.register(plugin)

      // Model validation fails before document is loaded, so cleanup isn't needed
      const gen = processor.extractWithVision('/test/file.mock', {
        model: 'notreal:model',
      })

      try {
        await gen.next()
      } catch {
        // Expected to throw
      }

      // Cleanup not called because load was never reached
      expect(cleanup).not.toHaveBeenCalled()
    })
  })

  describe('cancellation', () => {
    it('throws AbortError when signal is aborted before load', async () => {
      const plugin = createMockPlugin({
        load: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) }),
        parse: vi.fn().mockResolvedValue({ units: [createUnit(0)] }),
      })
      registry.register(plugin)

      const controller = new AbortController()
      controller.abort() // Abort immediately

      await expect(
        processor.extract('/test/file.mock', { signal: controller.signal }),
      ).rejects.toThrow(AbortError)
    })

    it('throws AbortError when signal is aborted during analysis', async () => {
      const controller = new AbortController()

      const plugin = createMockPlugin({
        load: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) }),
        parse: vi.fn().mockResolvedValue({
          units: [createUnit(0), createUnit(1), createUnit(2)],
        }),
        analyzeUnit: vi.fn().mockImplementation(async (unit) => {
          // Abort after first unit
          if (unit.index === 1) {
            controller.abort()
          }
          return unit
        }),
      })
      registry.register(plugin)

      await expect(
        processor.extract('/test/file.mock', { signal: controller.signal }),
      ).rejects.toThrow(AbortError)
    })

    it('throws AbortError when signal is aborted during sequential extraction', async () => {
      const controller = new AbortController()

      const plugin = createMockPlugin({
        load: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) }),
        parse: vi.fn().mockResolvedValue({
          units: [createUnit(0), createUnit(1), createUnit(2)],
        }),
        extractUnit: vi.fn().mockImplementation(async (unit) => {
          // Abort after first unit
          if (unit.index === 1) {
            controller.abort()
          }
          return {
            text: `text ${unit.index}`,
            charCount: 10,
            extraction: { method: 'digital', reliability: 'exact' },
          }
        }),
        capabilities: {
          ocr: false,
          vision: false,
          streaming: false,
          parallel: false, // Force sequential
          supportsRuns: true,
          multiUnit: true,
        },
      })
      registry.register(plugin)

      await expect(
        processor.extract('/test/file.mock', { signal: controller.signal, parallel: false }),
      ).rejects.toThrow(AbortError)
    })

    it('calls cleanup even when aborted', async () => {
      const cleanup = vi.fn()
      const controller = new AbortController()

      const plugin = createMockPlugin({
        load: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) }),
        parse: vi.fn().mockImplementation(async () => {
          // Abort after parse (doc exists at this point)
          controller.abort()
          return { units: [createUnit(0)] }
        }),
        cleanup,
      })
      registry.register(plugin)

      await expect(
        processor.extract('/test/file.mock', { signal: controller.signal }),
      ).rejects.toThrow(AbortError)

      expect(cleanup).toHaveBeenCalled()
    })
  })
})
