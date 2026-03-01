/**
 * Worker pool for parallel LibreOffice conversions.
 * Uses isolated user profiles to enable concurrent execution.
 */

import { EventEmitter } from 'node:events'
import { mkdir, rm } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PAGE_TIMEOUT_MS } from '../../common/timeouts.js'
import { obs } from '../../observability/index.js'
import { LATENCY_BOUNDARIES } from '../../observability/types.js'
import { OfficeConvertError } from '../errors.js'
import { Metrics } from '../signals.js'
import { checkLibreOffice, convertWithProfile } from './libreoffice.js'
import type { ConversionJob, ConversionResult, PoolOptions, PoolStats } from './types.js'

/** Default pool options */
const DEFAULT_POOL_OPTIONS: Required<PoolOptions> = {
  poolSize: 4,
  timeout: DEFAULT_PAGE_TIMEOUT_MS,
  profileBaseDir: join(tmpdir(), 'letmesense-office-pool'),
}

/**
 * Worker pool for parallel LibreOffice conversions.
 *
 * Uses isolated user profile directories to enable multiple
 * LibreOffice instances to run concurrently.
 *
 * @example
 * ```ts
 * const pool = new LibreOfficePool({ poolSize: 4 })
 * await pool.initialize()
 *
 * const results = await Promise.all([
 *   pool.convert('file1.pptx'),
 *   pool.convert('file2.pptx'),
 *   pool.convert('file3.pptx'),
 * ])
 *
 * await pool.shutdown()
 * ```
 */
export class LibreOfficePool extends EventEmitter {
  private options: Required<PoolOptions>
  private profileDirs: string[] = []
  private queue: ConversionJob[] = []
  private activeWorkers = 0
  private initialized = false
  private shuttingDown = false

  // Statistics
  private totalJobs = 0
  private totalDuration = 0

  // Observability
  private readonly obs = obs('libreoffice.pool')

  constructor(options: PoolOptions = {}) {
    super()

    // Determine pool size
    const cpuCount = cpus().length
    const defaultPoolSize = Math.min(4, Math.max(1, Math.floor(cpuCount / 2)))

    this.options = {
      ...DEFAULT_POOL_OPTIONS,
      poolSize: options.poolSize ?? defaultPoolSize,
      ...options,
    }
  }

  /**
   * Initialize the worker pool.
   * Creates profile directories for each worker.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Check LibreOffice availability
    const status = checkLibreOffice()
    if (!status.available) {
      throw new OfficeConvertError(`LibreOffice not available: ${status.error}`)
    }

    // Create base directory
    await mkdir(this.options.profileBaseDir, { recursive: true })

    // Create profile directories for each worker
    this.profileDirs = []
    for (let i = 0; i < this.options.poolSize; i++) {
      const profileDir = join(this.options.profileBaseDir, `worker-${i}-${Date.now()}`)
      await mkdir(profileDir, { recursive: true })
      this.profileDirs.push(profileDir)
    }

    this.initialized = true
    this.emit('initialized', { poolSize: this.options.poolSize })
  }

  /**
   * Convert an Office document to PDF.
   * Queues the job and processes when a worker is available.
   */
  async convert(inputPath: string, _outputDir?: string): Promise<ConversionResult> {
    if (!this.initialized) {
      await this.initialize()
    }

    if (this.shuttingDown) {
      throw new OfficeConvertError('Pool is shutting down')
    }

    return new Promise((resolve, reject) => {
      const job: ConversionJob = {
        inputPath,
        resolve: (result) => {
          // Store output dir override in result if needed
          resolve(result)
        },
        reject,
        startTime: Date.now(),
      }

      this.queue.push(job)
      this.updateMetrics()
      this.emit('jobQueued', { inputPath, queueLength: this.queue.length })
      this.processQueue()
    })
  }

  /**
   * Update observability metrics for pool state.
   */
  private updateMetrics(): void {
    const { metrics } = this.obs
    metrics.gauge(Metrics.LIBREOFFICE_POOL_ACTIVE).set(this.activeWorkers)
    metrics.gauge(Metrics.LIBREOFFICE_POOL_QUEUE_DEPTH).set(this.queue.length)
  }

  /**
   * Process queued jobs when workers are available.
   */
  private async processQueue(): Promise<void> {
    if (this.shuttingDown) return
    if (this.activeWorkers >= this.options.poolSize) return
    const job = this.queue.shift()
    if (!job) return
    const workerIndex = this.activeWorkers
    this.activeWorkers++
    this.updateMetrics()

    const { metrics, logger } = this.obs

    this.emit('jobStarted', {
      inputPath: job.inputPath,
      workerIndex,
      activeWorkers: this.activeWorkers,
    })

    const queueWaitMs = job.startTime ? Date.now() - job.startTime : 0
    logger.debug({ inputPath: job.inputPath, workerIndex, queueWaitMs }, 'Pool job started')

    try {
      const profileDir = this.profileDirs[workerIndex]
      const result = await convertWithProfile(job.inputPath, profileDir, {
        timeout: this.options.timeout,
        keepTemp: true, // Keep profile for reuse
      })

      // Update stats
      this.totalJobs++
      this.totalDuration += result.duration

      // Record metrics
      metrics.counter(Metrics.LIBREOFFICE_POOL_JOB_COUNT).add(1, { status: 'success' })
      metrics
        .histogram(Metrics.LIBREOFFICE_POOL_JOB_DURATION_MS, {
          boundaries: LATENCY_BOUNDARIES,
        })
        .record(result.duration)
      logger.debug(
        { inputPath: job.inputPath, workerIndex, duration: result.duration },
        'Pool job completed',
      )

      job.resolve({ ...result, workerIndex })

      this.emit('jobCompleted', {
        inputPath: job.inputPath,
        workerIndex,
        duration: result.duration,
      })
    } catch (err) {
      metrics.counter(Metrics.LIBREOFFICE_POOL_JOB_COUNT).add(1, { status: 'error' })
      logger.error({ inputPath: job.inputPath, workerIndex, err }, 'Pool job failed')

      job.reject(err instanceof Error ? err : new Error(String(err)))

      this.emit('jobFailed', {
        inputPath: job.inputPath,
        workerIndex,
        error: err,
      })
    } finally {
      this.activeWorkers--
      this.updateMetrics()
      // Process next job
      setImmediate(() => this.processQueue())
    }
  }

  /**
   * Get current pool statistics.
   */
  getStats(): PoolStats {
    return {
      totalJobs: this.totalJobs,
      activeWorkers: this.activeWorkers,
      queueLength: this.queue.length,
      avgDuration: this.totalJobs > 0 ? this.totalDuration / this.totalJobs : 0,
      poolSize: this.options.poolSize,
    }
  }

  /**
   * Wait for all queued jobs to complete.
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && this.activeWorkers === 0) {
      return
    }

    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.length === 0 && this.activeWorkers === 0) {
          resolve()
        } else {
          setTimeout(check, 100)
        }
      }
      check()
    })
  }

  /**
   * Shutdown the pool and cleanup resources.
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return

    this.shuttingDown = true

    // Wait for active jobs to complete
    await this.drain()

    // Cleanup profile directories
    await Promise.all(
      this.profileDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
    )

    // Cleanup base directory
    try {
      await rm(this.options.profileBaseDir, { recursive: true, force: true })
    } catch {
      // Ignore errors
    }

    this.profileDirs = []
    this.initialized = false
    this.shuttingDown = false

    this.emit('shutdown', this.getStats())
  }

  /**
   * Get the pool size.
   */
  get poolSize(): number {
    return this.options.poolSize
  }

  /**
   * Check if the pool is initialized.
   */
  get isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Check if the pool is shutting down.
   */
  get isShuttingDown(): boolean {
    return this.shuttingDown
  }
}

/**
 * Convert multiple files in parallel using a pool.
 *
 * @param inputPaths - Array of input file paths
 * @param options - Pool options
 * @returns Array of conversion results
 */
export async function convertManyToPdf(
  inputPaths: string[],
  options: PoolOptions = {},
): Promise<ConversionResult[]> {
  const pool = new LibreOfficePool(options)
  await pool.initialize()

  try {
    const results = await Promise.all(inputPaths.map((path) => pool.convert(path)))
    return results
  } finally {
    await pool.shutdown()
  }
}
