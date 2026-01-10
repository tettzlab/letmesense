/**
 * Health & System Metrics
 *
 * Runtime health indicators for monitoring and alerting.
 * Tracks system health, resource utilization, and dependency availability.
 */

import type { Metrics } from './types.js'

/**
 * Health metrics manager for tracking system health indicators.
 *
 * @example
 * ```typescript
 * const health = new HealthMetrics(metrics)
 *
 * // Set health status
 * health.setHealthy(true)
 *
 * // Track resource availability
 * health.setLibreOfficeAvailable(true)
 * health.setOcrWorkersActive(2)
 *
 * // Periodic memory updates
 * setInterval(() => health.setMemoryUsage(), 30000)
 * ```
 */
export class HealthMetrics {
  private metrics: Metrics

  constructor(metrics: Metrics) {
    this.metrics = metrics
  }

  /**
   * Set overall system health status
   * @param healthy - true if system is healthy, false otherwise
   */
  setHealthy(healthy: boolean): void {
    this.metrics.gauge('system.healthy').set(healthy ? 1 : 0)
  }

  /**
   * Set the number of active OCR workers
   * @param count - Number of active OCR worker instances
   */
  setOcrWorkersActive(count: number): void {
    this.metrics.gauge('ocr.worker.active.count').set(count)
  }

  /**
   * Set LibreOffice availability status
   * @param available - true if LibreOffice is available for conversion
   */
  setLibreOfficeAvailable(available: boolean): void {
    this.metrics.gauge('libreoffice.available').set(available ? 1 : 0)
  }

  /**
   * Update memory usage metrics from process.memoryUsage()
   * Call periodically (e.g., every 30 seconds) for monitoring
   */
  setMemoryUsage(): void {
    const usage = process.memoryUsage()
    this.metrics.gauge('process.memory.heap.bytes').set(usage.heapUsed)
    this.metrics.gauge('process.memory.rss.bytes').set(usage.rss)
    this.metrics.gauge('process.memory.external.bytes').set(usage.external)
    this.metrics.gauge('process.memory.array_buffers.bytes').set(usage.arrayBuffers)
  }

  /**
   * Record pipeline health status
   * @param healthy - true if pipeline is ready to process documents
   */
  setPipelineHealthy(healthy: boolean): void {
    this.metrics.gauge('pipeline.healthy').set(healthy ? 1 : 0)
  }

  /**
   * Set number of documents currently being processed
   * @param count - Number of documents in processing queue
   */
  setDocumentsInProgress(count: number): void {
    this.metrics.gauge('pipeline.documents.in_progress').set(count)
  }

  /**
   * Record AI provider availability
   * @param provider - Provider name (anthropic, openai, google, ollama)
   * @param available - true if provider is configured and available
   */
  setAiProviderAvailable(provider: string, available: boolean): void {
    this.metrics.gauge('ai.provider.available').set(available ? 1 : 0, { provider })
  }

  /**
   * Record all metrics at once for a health check endpoint
   * @returns Current health status object
   */
  recordHealthCheck(): {
    healthy: boolean
    memoryUsage: NodeJS.MemoryUsage
    uptime: number
    timestamp: string
  } {
    const memoryUsage = process.memoryUsage()
    const uptime = process.uptime()

    this.setMemoryUsage()
    this.metrics.gauge('process.uptime.seconds').set(uptime)

    return {
      healthy: true,
      memoryUsage,
      uptime,
      timestamp: new Date().toISOString(),
    }
  }
}

/**
 * Create a HealthMetrics instance from an observability context
 *
 * @example
 * ```typescript
 * import { obs } from '../lib/observability'
 * import { createHealthMetrics } from '../lib/observability/health'
 *
 * const { metrics } = obs('system')
 * const health = createHealthMetrics(metrics)
 * ```
 */
export function createHealthMetrics(metrics: Metrics): HealthMetrics {
  return new HealthMetrics(metrics)
}
