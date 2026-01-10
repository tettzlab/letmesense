/**
 * Tests for the high-level library API.
 */

import { describe, expect, it, vi } from 'vitest'

describe('api module exports', () => {
  it('exports sense function', async () => {
    const { sense } = await import('./api.js')
    expect(typeof sense).toBe('function')
  })

  it('exports senseStream function', async () => {
    const { senseStream } = await import('./api.js')
    expect(typeof senseStream).toBe('function')
  })

  it('exports estimateCost function', async () => {
    const { estimateCost } = await import('./api.js')
    expect(typeof estimateCost).toBe('function')
  })

  it('exports error classes', async () => {
    const {
      AbortError,
      AnalyzeError,
      ConvertError,
      ExtractError,
      FormatError,
      LoadError,
      NotImplementedError,
      OcrError,
      ParseError,
      PipelineError,
      RenderError,
    } = await import('./api.js')
    expect(AbortError).toBeDefined()
    expect(AnalyzeError).toBeDefined()
    expect(ConvertError).toBeDefined()
    expect(ExtractError).toBeDefined()
    expect(FormatError).toBeDefined()
    expect(LoadError).toBeDefined()
    expect(NotImplementedError).toBeDefined()
    expect(OcrError).toBeDefined()
    expect(ParseError).toBeDefined()
    expect(PipelineError).toBeDefined()
    expect(RenderError).toBeDefined()
  })

  it('exports error utilities', async () => {
    const { isAbortError, isPipelineError, isRecoverableError } = await import('./api.js')
    expect(typeof isAbortError).toBe('function')
    expect(typeof isPipelineError).toBe('function')
    expect(typeof isRecoverableError).toBe('function')
  })
})

describe('lib/index.ts exports', () => {
  it('exports main API functions', async () => {
    const lib = await import('../index.js')
    expect(typeof lib.sense).toBe('function')
    expect(typeof lib.senseStream).toBe('function')
    expect(typeof lib.estimateCost).toBe('function')
  })

  it('exports low-level functions', async () => {
    const lib = await import('../index.js')
    expect(typeof lib.extract).toBe('function')
    expect(typeof lib.extractUnits).toBe('function')
    expect(typeof lib.extractWithVision).toBe('function')
  })

  it('exports PipelineProcessor', async () => {
    const lib = await import('../index.js')
    expect(lib.PipelineProcessor).toBeDefined()
  })

  it('exports all error classes', async () => {
    const lib = await import('../index.js')
    expect(lib.AbortError).toBeDefined()
    expect(lib.AnalyzeError).toBeDefined()
    expect(lib.ConvertError).toBeDefined()
    expect(lib.ExtractError).toBeDefined()
    expect(lib.FormatError).toBeDefined()
    expect(lib.LoadError).toBeDefined()
    expect(lib.NotImplementedError).toBeDefined()
    expect(lib.OcrError).toBeDefined()
    expect(lib.ParseError).toBeDefined()
    expect(lib.PipelineError).toBeDefined()
    expect(lib.RenderError).toBeDefined()
  })

  it('exports registry functions', async () => {
    const lib = await import('../index.js')
    expect(typeof lib.getDefaultRegistry).toBe('function')
    expect(typeof lib.registerPlugin).toBe('function')
    expect(lib.PluginRegistry).toBeDefined()
  })
})

describe('sense function', () => {
  it('extracts text from a PDF file', async () => {
    const { sense } = await import('./api.js')
    const result = await sense('samples/born-digital.pdf')

    expect(result.text).toBeDefined()
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.format).toBe('pdf')
    expect(result.unitCount).toBeGreaterThan(0)
    expect(result.errors).toEqual([])
  })

  it('accepts extraction options', async () => {
    const { sense } = await import('./api.js')
    const onProgress = vi.fn()

    const result = await sense('samples/born-digital.pdf', {
      parallel: true,
      includeMetadata: true,
      onProgress,
    })

    expect(result.metadata).toBeDefined()
    expect(onProgress).toHaveBeenCalled()
  })

  it('supports AbortSignal for cancellation', async () => {
    const { sense, isAbortError } = await import('./api.js')
    const controller = new AbortController()

    // Abort immediately
    controller.abort()

    try {
      await sense('samples/born-digital.pdf', { signal: controller.signal })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(isAbortError(err)).toBe(true)
    }
  })

  it('returns proper SenseResult structure', async () => {
    const { sense } = await import('./api.js')
    const result = await sense('samples/born-digital.pdf')

    // Check all required fields
    expect(result).toHaveProperty('text')
    expect(result).toHaveProperty('source')
    expect(result).toHaveProperty('format')
    expect(result).toHaveProperty('unitCount')
    expect(result).toHaveProperty('runCount')
    expect(result).toHaveProperty('errors')
  })

  it('does not include tokens or cost for standard extraction', async () => {
    const { sense } = await import('./api.js')
    const result = await sense('samples/born-digital.pdf')

    expect(result.tokens).toBeUndefined()
    expect(result.cost).toBeUndefined()
  })

  it('throws when both llm and vision are set', async () => {
    const { sense } = await import('./api.js')

    await expect(sense('samples/born-digital.pdf', { llm: true, vision: true })).rejects.toThrow(
      'Cannot use both `llm` and `vision` options simultaneously',
    )
  })

  it('throws when both llm and vision are set as objects', async () => {
    const { sense } = await import('./api.js')

    await expect(
      sense('samples/born-digital.pdf', {
        llm: { model: 'openai:gpt-5-mini' },
        vision: { model: 'openai:gpt-5-mini' },
      }),
    ).rejects.toThrow('Cannot use both `llm` and `vision` options simultaneously')
  })
})

describe('SenseOptions type coverage', () => {
  it('accepts all extraction options', async () => {
    // This test ensures TypeScript compilation works with all options
    const { sense } = await import('./api.js')

    // All options should be accepted without type errors
    const options = {
      format: 'pdf' as const,
      separator: '\n---\n',
      parallel: true,
      strict: false,
      ocrLanguage: 'eng+jpn',
      includeMetadata: true,
    }

    const result = await sense('samples/born-digital.pdf', options)
    expect(result).toBeDefined()
  })
})
