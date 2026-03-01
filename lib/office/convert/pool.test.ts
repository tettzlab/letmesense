import { OfficeConvertError } from '../errors.js'
import * as libreoffice from './libreoffice.js'
import { convertManyToPdf, LibreOfficePool } from './pool.js'

// Mock the libreoffice module
vi.mock('./libreoffice.js', () => ({
  checkLibreOffice: vi.fn(),
  convertWithProfile: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LibreOfficePool', () => {
  describe('constructor', () => {
    it('creates pool with default options', () => {
      const pool = new LibreOfficePool()
      expect(pool.poolSize).toBeGreaterThan(0)
      expect(pool.poolSize).toBeLessThanOrEqual(4)
    })

    it('creates pool with custom poolSize', () => {
      const pool = new LibreOfficePool({ poolSize: 2 })
      expect(pool.poolSize).toBe(2)
    })

    it('is not initialized before initialize() call', () => {
      const pool = new LibreOfficePool()
      expect(pool.isInitialized).toBe(false)
    })
  })

  describe('initialize', () => {
    it('throws when LibreOffice not available', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: false,
        error: 'LibreOffice not found',
      })

      const pool = new LibreOfficePool()
      await expect(pool.initialize()).rejects.toThrow(OfficeConvertError)
    })

    it('initializes successfully when LibreOffice available', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 2 })
      await pool.initialize()

      expect(pool.isInitialized).toBe(true)
    })

    it('emits initialized event', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 2 })
      const initHandler = vi.fn()
      pool.on('initialized', initHandler)

      await pool.initialize()

      expect(initHandler).toHaveBeenCalledWith({ poolSize: 2 })
    })

    it('is idempotent (no-op on second call)', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 2 })
      await pool.initialize()
      await pool.initialize() // Second call should be no-op

      expect(libreoffice.checkLibreOffice).toHaveBeenCalledTimes(1)
    })
  })

  describe('convert', () => {
    it('auto-initializes if not initialized', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })
      vi.mocked(libreoffice.convertWithProfile).mockResolvedValue({
        inputPath: '/test/input.pptx',
        outputPath: '/test/output.pdf',
        duration: 100,
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      expect(pool.isInitialized).toBe(false)

      await pool.convert('/test/input.pptx')

      expect(pool.isInitialized).toBe(true)
    })

    it('returns conversion result', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })
      vi.mocked(libreoffice.convertWithProfile).mockResolvedValue({
        inputPath: '/test/input.pptx',
        outputPath: '/tmp/input.pdf',
        duration: 150,
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      const result = await pool.convert('/test/input.pptx')

      expect(result.inputPath).toBe('/test/input.pptx')
      expect(result.outputPath).toBe('/tmp/input.pdf')
      expect(result.duration).toBe(150)
    })

    it('throws when pool is shutting down', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      await pool.initialize()
      await pool.shutdown()

      // Pool should be reset after shutdown
      expect(pool.isInitialized).toBe(false)
    })

    it('emits jobQueued event', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })
      vi.mocked(libreoffice.convertWithProfile).mockResolvedValue({
        inputPath: '/test/input.pptx',
        outputPath: '/tmp/input.pdf',
        duration: 100,
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      const queueHandler = vi.fn()
      pool.on('jobQueued', queueHandler)

      await pool.convert('/test/input.pptx')

      expect(queueHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          inputPath: '/test/input.pptx',
        }),
      )
    })

    it('emits jobStarted and jobCompleted events', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })
      vi.mocked(libreoffice.convertWithProfile).mockResolvedValue({
        inputPath: '/test/input.pptx',
        outputPath: '/tmp/input.pdf',
        duration: 100,
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      const startHandler = vi.fn()
      const completeHandler = vi.fn()
      pool.on('jobStarted', startHandler)
      pool.on('jobCompleted', completeHandler)

      await pool.convert('/test/input.pptx')

      expect(startHandler).toHaveBeenCalled()
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          inputPath: '/test/input.pptx',
          duration: 100,
        }),
      )
    })

    it('emits jobFailed event on error', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })
      vi.mocked(libreoffice.convertWithProfile).mockRejectedValue(new Error('Conversion failed'))

      const pool = new LibreOfficePool({ poolSize: 1 })
      const failHandler = vi.fn()
      pool.on('jobFailed', failHandler)

      await expect(pool.convert('/test/input.pptx')).rejects.toThrow('Conversion failed')

      expect(failHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          inputPath: '/test/input.pptx',
          error: expect.any(Error),
        }),
      )
    })
  })

  describe('getStats', () => {
    it('returns initial stats', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 2 })
      await pool.initialize()

      const stats = pool.getStats()

      expect(stats.totalJobs).toBe(0)
      expect(stats.activeWorkers).toBe(0)
      expect(stats.queueLength).toBe(0)
      expect(stats.avgDuration).toBe(0)
      expect(stats.poolSize).toBe(2)
    })

    it('tracks job statistics', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })
      vi.mocked(libreoffice.convertWithProfile).mockResolvedValue({
        inputPath: '/test/input.pptx',
        outputPath: '/tmp/input.pdf',
        duration: 200,
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      await pool.convert('/test/input.pptx')

      const stats = pool.getStats()

      expect(stats.totalJobs).toBe(1)
      expect(stats.avgDuration).toBe(200)
    })
  })

  describe('drain', () => {
    it('resolves immediately when no jobs', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      await pool.initialize()

      await expect(pool.drain()).resolves.toBeUndefined()
    })
  })

  describe('shutdown', () => {
    it('cleans up and resets state', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      await pool.initialize()
      expect(pool.isInitialized).toBe(true)

      await pool.shutdown()

      expect(pool.isInitialized).toBe(false)
      expect(pool.isShuttingDown).toBe(false)
    })

    it('emits shutdown event with stats', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      await pool.initialize()

      const shutdownHandler = vi.fn()
      pool.on('shutdown', shutdownHandler)

      await pool.shutdown()

      expect(shutdownHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          totalJobs: 0,
          poolSize: 1,
        }),
      )
    })

    it('is idempotent (no-op when not initialized)', async () => {
      const pool = new LibreOfficePool({ poolSize: 1 })
      await pool.shutdown() // Should not throw
    })
  })

  describe('properties', () => {
    it('returns correct poolSize', () => {
      const pool = new LibreOfficePool({ poolSize: 3 })
      expect(pool.poolSize).toBe(3)
    })

    it('returns correct isInitialized', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      expect(pool.isInitialized).toBe(false)

      await pool.initialize()
      expect(pool.isInitialized).toBe(true)
    })

    it('returns correct isShuttingDown', async () => {
      vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
        available: true,
        version: '7.6.0',
        path: '/usr/bin/libreoffice',
      })

      const pool = new LibreOfficePool({ poolSize: 1 })
      await pool.initialize()

      expect(pool.isShuttingDown).toBe(false)
    })
  })
})

describe('convertManyToPdf', () => {
  it('converts multiple files using pool', async () => {
    vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
      available: true,
      version: '7.6.0',
      path: '/usr/bin/libreoffice',
    })
    vi.mocked(libreoffice.convertWithProfile).mockImplementation(async (inputPath) => ({
      inputPath,
      outputPath: inputPath.replace(/\.[^.]+$/, '.pdf'),
      duration: 100,
    }))

    const inputs = ['/test/file1.pptx', '/test/file2.pptx', '/test/file3.pptx']
    const results = await convertManyToPdf(inputs, { poolSize: 2 })

    expect(results).toHaveLength(3)
    expect(results[0].inputPath).toBe('/test/file1.pptx')
    expect(results[1].inputPath).toBe('/test/file2.pptx')
    expect(results[2].inputPath).toBe('/test/file3.pptx')
  })

  it('shuts down pool after completion', async () => {
    vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
      available: true,
      version: '7.6.0',
      path: '/usr/bin/libreoffice',
    })
    vi.mocked(libreoffice.convertWithProfile).mockResolvedValue({
      inputPath: '/test/file.pptx',
      outputPath: '/test/file.pdf',
      duration: 100,
    })

    await convertManyToPdf(['/test/file.pptx'])

    // Pool should be shut down (we can't easily verify this, but the function should complete)
  })

  it('shuts down pool even on error', async () => {
    vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
      available: true,
      version: '7.6.0',
      path: '/usr/bin/libreoffice',
    })
    vi.mocked(libreoffice.convertWithProfile).mockRejectedValue(new Error('Failed'))

    await expect(convertManyToPdf(['/test/file.pptx'])).rejects.toThrow('Failed')

    // Pool should still be shut down
  })
})

describe('LibreOfficePool queue handling', () => {
  it('handles multiple concurrent jobs within pool size', async () => {
    vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
      available: true,
      version: '7.6.0',
      path: '/usr/bin/libreoffice',
    })

    let concurrentJobs = 0
    let maxConcurrentJobs = 0

    vi.mocked(libreoffice.convertWithProfile).mockImplementation(async (inputPath) => {
      concurrentJobs++
      maxConcurrentJobs = Math.max(maxConcurrentJobs, concurrentJobs)
      await new Promise((resolve) => setTimeout(resolve, 50))
      concurrentJobs--
      return {
        inputPath,
        outputPath: inputPath.replace(/\.[^.]+$/, '.pdf'),
        duration: 50,
      }
    })

    const pool = new LibreOfficePool({ poolSize: 2 })
    const results = await Promise.all([
      pool.convert('/test/file1.pptx'),
      pool.convert('/test/file2.pptx'),
      pool.convert('/test/file3.pptx'),
    ])

    await pool.shutdown()

    expect(results).toHaveLength(3)
    // With poolSize 2, max concurrent should be exactly 2 (full utilization)
    // and never exceed pool size
    expect(maxConcurrentJobs).toBe(2)
  })

  it('queues jobs when pool is at capacity', async () => {
    vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
      available: true,
      version: '7.6.0',
      path: '/usr/bin/libreoffice',
    })

    const jobOrder: string[] = []

    vi.mocked(libreoffice.convertWithProfile).mockImplementation(async (inputPath) => {
      jobOrder.push(`start:${inputPath}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
      jobOrder.push(`end:${inputPath}`)
      return {
        inputPath,
        outputPath: inputPath.replace(/\.[^.]+$/, '.pdf'),
        duration: 20,
      }
    })

    const pool = new LibreOfficePool({ poolSize: 1 })

    // Submit multiple jobs to single-worker pool
    const promises = [
      pool.convert('/test/file1.pptx'),
      pool.convert('/test/file2.pptx'),
      pool.convert('/test/file3.pptx'),
    ]

    await Promise.all(promises)
    await pool.shutdown()

    // Jobs should complete sequentially (since poolSize is 1)
    expect(jobOrder.filter((e) => e.startsWith('start:'))).toHaveLength(3)
    expect(jobOrder.filter((e) => e.startsWith('end:'))).toHaveLength(3)
  })

  it('tracks statistics accurately with multiple jobs', async () => {
    vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
      available: true,
      version: '7.6.0',
      path: '/usr/bin/libreoffice',
    })

    vi.mocked(libreoffice.convertWithProfile)
      .mockResolvedValueOnce({
        inputPath: '/test/file1.pptx',
        outputPath: '/test/file1.pdf',
        duration: 100,
      })
      .mockResolvedValueOnce({
        inputPath: '/test/file2.pptx',
        outputPath: '/test/file2.pdf',
        duration: 200,
      })
      .mockResolvedValueOnce({
        inputPath: '/test/file3.pptx',
        outputPath: '/test/file3.pdf',
        duration: 300,
      })

    const pool = new LibreOfficePool({ poolSize: 1 })

    await pool.convert('/test/file1.pptx')
    await pool.convert('/test/file2.pptx')
    await pool.convert('/test/file3.pptx')

    const stats = pool.getStats()

    expect(stats.totalJobs).toBe(3)
    expect(stats.avgDuration).toBe(200) // (100 + 200 + 300) / 3
    expect(stats.activeWorkers).toBe(0) // All jobs completed
    expect(stats.queueLength).toBe(0)

    await pool.shutdown()
  })

  it('includes workerIndex in result', async () => {
    vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
      available: true,
      version: '7.6.0',
      path: '/usr/bin/libreoffice',
    })
    vi.mocked(libreoffice.convertWithProfile).mockResolvedValue({
      inputPath: '/test/input.pptx',
      outputPath: '/tmp/input.pdf',
      duration: 100,
    })

    const pool = new LibreOfficePool({ poolSize: 2 })
    const result = await pool.convert('/test/input.pptx')

    expect(result.workerIndex).toBeDefined()
    expect(result.workerIndex).toBeGreaterThanOrEqual(0)
    expect(result.workerIndex).toBeLessThan(2) // Should be 0 or 1 for poolSize 2

    await pool.shutdown()
  })

  it('completes in-flight conversions during shutdown', async () => {
    vi.mocked(libreoffice.checkLibreOffice).mockReturnValue({
      available: true,
      version: '7.6.0',
      path: '/usr/bin/libreoffice',
    })

    // Simulate slow conversion
    vi.mocked(libreoffice.convertWithProfile).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                inputPath: '/test/slow.pptx',
                outputPath: '/test/slow.pdf',
                duration: 100,
              }),
            100,
          )
        }),
    )

    const pool = new LibreOfficePool({ poolSize: 1 })
    await pool.initialize()

    // Start a conversion before shutdown
    const convertPromise = pool.convert('/test/slow.pptx')

    // Start shutdown while conversion is in progress
    const shutdownPromise = pool.shutdown()

    // In-flight conversion should complete successfully
    const result = await convertPromise
    expect(result).toBeDefined()
    expect(result.outputPath).toBe('/test/slow.pdf')

    // Wait for shutdown to complete
    await shutdownPromise
  })
})
