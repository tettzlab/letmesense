import { describe, expect, it } from 'vitest'
import {
  AbortError,
  AnalyzeError,
  ConvertError,
  ExtractError,
  FormatError,
  isAbortError,
  isPipelineError,
  isRecoverableError,
  LoadError,
  NotImplementedError,
  OcrError,
  ParseError,
  PipelineError,
  RenderError,
  throwIfAborted,
  wrapError,
} from './errors.js'

describe('PipelineError', () => {
  it('creates base error with phase', () => {
    const err = new PipelineError('test error', 'load')
    expect(err.message).toBe('test error')
    expect(err.phase).toBe('load')
    expect(err.name).toBe('PipelineError')
    expect(err.recoverable).toBe(false)
  })

  it('preserves cause', () => {
    const cause = new Error('original')
    const err = new PipelineError('wrapped', 'parse', { cause })
    expect(err.cause).toBe(cause)
  })

  it('sets recoverable flag', () => {
    const err = new PipelineError('recoverable', 'analyze', { recoverable: true })
    expect(err.recoverable).toBe(true)
  })
})

describe('phase-specific errors', () => {
  it('creates LoadError', () => {
    const err = new LoadError('file not found')
    expect(err.name).toBe('LoadError')
    expect(err.phase).toBe('load')
    expect(err.recoverable).toBe(false)
  })

  it('creates ParseError', () => {
    const err = new ParseError('invalid format')
    expect(err.name).toBe('ParseError')
    expect(err.phase).toBe('parse')
    expect(err.recoverable).toBe(false)
  })

  it('creates AnalyzeError', () => {
    const err = new AnalyzeError('analysis failed')
    expect(err.name).toBe('AnalyzeError')
    expect(err.phase).toBe('analyze')
    expect(err.recoverable).toBe(true)
  })

  it('creates ExtractError', () => {
    const err = new ExtractError('extraction failed')
    expect(err.name).toBe('ExtractError')
    expect(err.phase).toBe('extract')
    expect(err.recoverable).toBe(true)
  })

  it('creates RenderError', () => {
    const err = new RenderError('render failed')
    expect(err.name).toBe('RenderError')
    expect(err.phase).toBe('render')
    expect(err.recoverable).toBe(true)
  })

  it('creates OcrError', () => {
    const err = new OcrError('ocr failed')
    expect(err.name).toBe('OcrError')
    expect(err.phase).toBe('ocr')
    expect(err.recoverable).toBe(true)
  })

  it('creates FormatError', () => {
    const err = new FormatError('format failed')
    expect(err.name).toBe('FormatError')
    expect(err.phase).toBe('format')
    expect(err.recoverable).toBe(false)
  })

  it('creates ConvertError', () => {
    const err = new ConvertError('conversion failed')
    expect(err.name).toBe('ConvertError')
    expect(err.phase).toBe('convert')
    expect(err.recoverable).toBe(false)
  })

  it('creates NotImplementedError with feature name', () => {
    const err = new NotImplementedError('vision extraction')
    expect(err.name).toBe('NotImplementedError')
    expect(err.message).toBe('Not implemented: vision extraction')
    expect(err.phase).toBe('format') // default phase
    expect(err.recoverable).toBe(false)
  })

  it('creates NotImplementedError with custom phase', () => {
    const err = new NotImplementedError('custom feature', 'extract')
    expect(err.phase).toBe('extract')
  })

  it('creates AbortError with default phase', () => {
    const err = new AbortError()
    expect(err.name).toBe('AbortError')
    expect(err.message).toBe('Operation aborted')
    expect(err.phase).toBe('extract') // default phase
    expect(err.recoverable).toBe(false)
  })

  it('creates AbortError with custom phase', () => {
    const err = new AbortError('analyze')
    expect(err.phase).toBe('analyze')
  })
})

describe('wrapError', () => {
  it('returns PipelineError as-is', () => {
    const original = new LoadError('already wrapped')
    const wrapped = wrapError(original, 'parse')
    expect(wrapped).toBe(original)
  })

  it('wraps Error into phase-specific error', () => {
    const original = new Error('plain error')
    const wrapped = wrapError(original, 'load')
    expect(wrapped).toBeInstanceOf(LoadError)
    expect(wrapped.cause).toBe(original)
  })

  it('wraps string into error', () => {
    const wrapped = wrapError('string error', 'extract')
    expect(wrapped).toBeInstanceOf(ExtractError)
    expect(wrapped.message).toBe('string error')
  })

  it('wraps with custom message', () => {
    const original = new Error('original')
    const wrapped = wrapError(original, 'parse', 'custom message')
    expect(wrapped.message).toBe('custom message')
    expect(wrapped.cause).toBe(original)
  })

  it('wraps into correct error type for each phase', () => {
    expect(wrapError(new Error('x'), 'load')).toBeInstanceOf(LoadError)
    expect(wrapError(new Error('x'), 'parse')).toBeInstanceOf(ParseError)
    expect(wrapError(new Error('x'), 'analyze')).toBeInstanceOf(AnalyzeError)
    expect(wrapError(new Error('x'), 'extract')).toBeInstanceOf(ExtractError)
    expect(wrapError(new Error('x'), 'render')).toBeInstanceOf(RenderError)
    expect(wrapError(new Error('x'), 'ocr')).toBeInstanceOf(OcrError)
    expect(wrapError(new Error('x'), 'format')).toBeInstanceOf(FormatError)
    expect(wrapError(new Error('x'), 'convert')).toBeInstanceOf(ConvertError)
  })
})

describe('isPipelineError', () => {
  it('returns true for PipelineError', () => {
    expect(isPipelineError(new PipelineError('test', 'load'))).toBe(true)
  })

  it('returns true for derived errors', () => {
    expect(isPipelineError(new LoadError('test'))).toBe(true)
    expect(isPipelineError(new ExtractError('test'))).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isPipelineError(new Error('test'))).toBe(false)
  })

  it('returns false for non-errors', () => {
    expect(isPipelineError('string')).toBe(false)
    expect(isPipelineError(null)).toBe(false)
    expect(isPipelineError(undefined)).toBe(false)
  })
})

describe('isRecoverableError', () => {
  it('returns true for recoverable errors', () => {
    expect(isRecoverableError(new AnalyzeError('test'))).toBe(true)
    expect(isRecoverableError(new ExtractError('test'))).toBe(true)
    expect(isRecoverableError(new RenderError('test'))).toBe(true)
    expect(isRecoverableError(new OcrError('test'))).toBe(true)
  })

  it('returns false for non-recoverable errors', () => {
    expect(isRecoverableError(new LoadError('test'))).toBe(false)
    expect(isRecoverableError(new ParseError('test'))).toBe(false)
    expect(isRecoverableError(new FormatError('test'))).toBe(false)
    expect(isRecoverableError(new ConvertError('test'))).toBe(false)
    expect(isRecoverableError(new NotImplementedError('test'))).toBe(false)
    expect(isRecoverableError(new AbortError())).toBe(false)
  })

  it('returns false for non-pipeline errors', () => {
    expect(isRecoverableError(new Error('test'))).toBe(false)
    expect(isRecoverableError('string')).toBe(false)
  })
})

describe('isAbortError', () => {
  it('returns true for AbortError', () => {
    expect(isAbortError(new AbortError())).toBe(true)
    expect(isAbortError(new AbortError('load'))).toBe(true)
  })

  it('returns false for other pipeline errors', () => {
    expect(isAbortError(new LoadError('test'))).toBe(false)
    expect(isAbortError(new ExtractError('test'))).toBe(false)
    expect(isAbortError(new NotImplementedError('test'))).toBe(false)
  })

  it('returns false for non-pipeline errors', () => {
    expect(isAbortError(new Error('test'))).toBe(false)
    expect(isAbortError('string')).toBe(false)
  })
})

describe('throwIfAborted', () => {
  it('does nothing when signal is undefined', () => {
    expect(() => throwIfAborted(undefined, 'extract')).not.toThrow()
  })

  it('does nothing when signal is not aborted', () => {
    const controller = new AbortController()
    expect(() => throwIfAborted(controller.signal, 'extract')).not.toThrow()
  })

  it('throws AbortError when signal is aborted', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => throwIfAborted(controller.signal, 'extract')).toThrow(AbortError)
  })

  it('throws AbortError with correct phase', () => {
    const controller = new AbortController()
    controller.abort()
    try {
      throwIfAborted(controller.signal, 'analyze')
    } catch (err) {
      expect(err).toBeInstanceOf(AbortError)
      expect((err as AbortError).phase).toBe('analyze')
    }
  })
})
