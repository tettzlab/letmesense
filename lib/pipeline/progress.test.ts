import { errorEvent, ProgressReporter } from './progress.js'

describe('event helpers', () => {
  it('creates error event with Error', () => {
    const err = new Error('test error')
    const event = errorEvent('analyze', err, 2)
    expect(event).toEqual({ type: 'error', phase: 'analyze', error: err, unitIndex: 2 })
  })

  it('creates error event with UnitError', () => {
    const unitError = { unitIndex: 3, phase: 'extract' as const, message: 'failed' }
    const event = errorEvent('extract', unitError)
    expect(event).toEqual({
      type: 'error',
      phase: 'extract',
      error: unitError,
      unitIndex: undefined,
    })
  })
})

describe('ProgressReporter', () => {
  it('emits events to callback', () => {
    const callback = vi.fn()
    const reporter = new ProgressReporter(callback)

    reporter.emit({ type: 'load-start', source: 'test.pdf' })
    expect(callback).toHaveBeenCalledWith({ type: 'load-start', source: 'test.pdf' })
  })

  it('handles missing callback gracefully', () => {
    const reporter = new ProgressReporter()
    // Should not throw
    reporter.emit({ type: 'load-start', source: 'test.pdf' })
  })

  describe('convenience methods', () => {
    it('emits load-start', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.loadStart('test.pdf')
      expect(callback).toHaveBeenCalledWith({ type: 'load-start', source: 'test.pdf' })
    })

    it('emits load-done', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.loadDone('test.pdf', 'pdf', 1024)
      expect(callback).toHaveBeenCalledWith({
        type: 'load-done',
        source: 'test.pdf',
        format: 'pdf',
        byteSize: 1024,
      })
    })

    it('emits parse-start', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.parseStart('docx')
      expect(callback).toHaveBeenCalledWith({ type: 'parse-start', format: 'docx' })
    })

    it('emits parse-done', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.parseDone(10)
      expect(callback).toHaveBeenCalledWith({ type: 'parse-done', unitCount: 10 })
    })

    it('emits analyze-start', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.analyzeStart(5)
      expect(callback).toHaveBeenCalledWith({ type: 'analyze-start', unitCount: 5 })
    })

    it('emits analyze-unit', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.analyzeUnit(2, 5)
      expect(callback).toHaveBeenCalledWith({ type: 'analyze-unit', unitIndex: 2, totalUnits: 5 })
    })

    it('emits analyze-done', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.analyzeDone(5)
      expect(callback).toHaveBeenCalledWith({ type: 'analyze-done', unitCount: 5 })
    })

    it('emits extract-start', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.extractStart(3)
      expect(callback).toHaveBeenCalledWith({ type: 'extract-start', runCount: 3 })
    })

    it('emits extract-run-start', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.extractRunStart(1, 4)
      expect(callback).toHaveBeenCalledWith({
        type: 'extract-run-start',
        runIndex: 1,
        unitCount: 4,
      })
    })

    it('emits extract-unit', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.extractUnit(2, 10, 500)
      expect(callback).toHaveBeenCalledWith({
        type: 'extract-unit',
        unitIndex: 2,
        totalUnits: 10,
        charCount: 500,
      })
    })

    it('emits extract-run-done', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.extractRunDone(1, 2000)
      expect(callback).toHaveBeenCalledWith({
        type: 'extract-run-done',
        runIndex: 1,
        charCount: 2000,
      })
    })

    it('emits extract-done', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.extractDone(5000)
      expect(callback).toHaveBeenCalledWith({ type: 'extract-done', totalChars: 5000 })
    })

    it('emits format-start', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.formatStart(5)
      expect(callback).toHaveBeenCalledWith({ type: 'format-start', totalUnits: 5 })
    })

    it('emits format-unit', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.formatUnit(2, 5, 'content chunk')
      expect(callback).toHaveBeenCalledWith({
        type: 'format-unit',
        unitIndex: 2,
        totalUnits: 5,
        content: 'content chunk',
      })
    })

    it('emits format-done', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      reporter.formatDone(5, 10000)
      expect(callback).toHaveBeenCalledWith({
        type: 'format-done',
        totalUnits: 5,
        totalChars: 10000,
      })
    })

    it('emits error', () => {
      const callback = vi.fn()
      const reporter = new ProgressReporter(callback)
      const err = new Error('test')
      reporter.error('analyze', err, 2)
      expect(callback).toHaveBeenCalledWith({
        type: 'error',
        phase: 'analyze',
        error: err,
        unitIndex: 2,
      })
    })
  })
})
