/**
 * Tests for health metrics module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHealthMetrics, HealthMetrics } from './health.js'
import type { Metrics } from './types.js'

describe('HealthMetrics', () => {
  let mockMetrics: Metrics
  let mockGaugeValues: Map<string, { value: number; labels?: Record<string, string> }>
  let health: HealthMetrics

  beforeEach(() => {
    mockGaugeValues = new Map()

    mockMetrics = {
      counter: vi.fn(() => ({ add: vi.fn() })),
      histogram: vi.fn(() => ({ record: vi.fn() })),
      gauge: vi.fn((name: string) => ({
        set: (value: number, labels?: Record<string, string>) => {
          mockGaugeValues.set(name, { value, labels })
        },
        get: () => mockGaugeValues.get(name)?.value ?? 0,
      })),
    }

    health = new HealthMetrics(mockMetrics)
  })

  describe('setHealthy', () => {
    it('sets system.healthy to 1 when healthy', () => {
      health.setHealthy(true)
      expect(mockGaugeValues.get('system.healthy')?.value).toBe(1)
    })

    it('sets system.healthy to 0 when unhealthy', () => {
      health.setHealthy(false)
      expect(mockGaugeValues.get('system.healthy')?.value).toBe(0)
    })
  })

  describe('setOcrWorkersActive', () => {
    it('sets ocr.worker.active.count gauge', () => {
      health.setOcrWorkersActive(4)
      expect(mockGaugeValues.get('ocr.worker.active.count')?.value).toBe(4)
    })

    it('handles zero workers', () => {
      health.setOcrWorkersActive(0)
      expect(mockGaugeValues.get('ocr.worker.active.count')?.value).toBe(0)
    })
  })

  describe('setLibreOfficeAvailable', () => {
    it('sets libreoffice.available to 1 when available', () => {
      health.setLibreOfficeAvailable(true)
      expect(mockGaugeValues.get('libreoffice.available')?.value).toBe(1)
    })

    it('sets libreoffice.available to 0 when unavailable', () => {
      health.setLibreOfficeAvailable(false)
      expect(mockGaugeValues.get('libreoffice.available')?.value).toBe(0)
    })
  })

  describe('setMemoryUsage', () => {
    it('sets memory gauges from process.memoryUsage()', () => {
      health.setMemoryUsage()

      // Verify all memory gauges are set
      expect(mockGaugeValues.has('process.memory.heap.bytes')).toBe(true)
      expect(mockGaugeValues.has('process.memory.rss.bytes')).toBe(true)
      expect(mockGaugeValues.has('process.memory.external.bytes')).toBe(true)
      expect(mockGaugeValues.has('process.memory.array_buffers.bytes')).toBe(true)

      // Values should be positive numbers
      expect(mockGaugeValues.get('process.memory.heap.bytes')?.value).toBeGreaterThan(0)
      expect(mockGaugeValues.get('process.memory.rss.bytes')?.value).toBeGreaterThan(0)
    })
  })

  describe('setPipelineHealthy', () => {
    it('sets pipeline.healthy to 1 when healthy', () => {
      health.setPipelineHealthy(true)
      expect(mockGaugeValues.get('pipeline.healthy')?.value).toBe(1)
    })

    it('sets pipeline.healthy to 0 when unhealthy', () => {
      health.setPipelineHealthy(false)
      expect(mockGaugeValues.get('pipeline.healthy')?.value).toBe(0)
    })
  })

  describe('setDocumentsInProgress', () => {
    it('sets pipeline.documents.in_progress gauge', () => {
      health.setDocumentsInProgress(5)
      expect(mockGaugeValues.get('pipeline.documents.in_progress')?.value).toBe(5)
    })
  })

  describe('setAiProviderAvailable', () => {
    it('sets ai.provider.available with provider label', () => {
      health.setAiProviderAvailable('anthropic', true)
      const entry = mockGaugeValues.get('ai.provider.available')
      expect(entry?.value).toBe(1)
      expect(entry?.labels).toEqual({ provider: 'anthropic' })
    })

    it('sets to 0 when provider unavailable', () => {
      health.setAiProviderAvailable('openai', false)
      const entry = mockGaugeValues.get('ai.provider.available')
      expect(entry?.value).toBe(0)
      expect(entry?.labels).toEqual({ provider: 'openai' })
    })
  })

  describe('recordHealthCheck', () => {
    it('returns health status object', () => {
      const result = health.recordHealthCheck()

      expect(result.healthy).toBe(true)
      expect(result.memoryUsage).toBeDefined()
      expect(result.memoryUsage.heapUsed).toBeGreaterThan(0)
      expect(result.uptime).toBeGreaterThan(0)
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('sets memory gauges', () => {
      health.recordHealthCheck()

      expect(mockGaugeValues.has('process.memory.heap.bytes')).toBe(true)
      expect(mockGaugeValues.has('process.memory.rss.bytes')).toBe(true)
    })

    it('sets uptime gauge', () => {
      health.recordHealthCheck()
      expect(mockGaugeValues.get('process.uptime.seconds')?.value).toBeGreaterThan(0)
    })
  })
})

describe('createHealthMetrics', () => {
  it('creates HealthMetrics instance', () => {
    const mockMetrics: Metrics = {
      counter: vi.fn(() => ({ add: vi.fn() })),
      histogram: vi.fn(() => ({ record: vi.fn() })),
      gauge: vi.fn(() => ({ set: vi.fn(), get: () => 0 })),
    }

    const health = createHealthMetrics(mockMetrics)
    expect(health).toBeInstanceOf(HealthMetrics)
  })
})
