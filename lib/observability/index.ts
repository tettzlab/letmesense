/**
 * Observability Module
 *
 * Provides a unified interface for logging, tracing, and metrics.
 *
 * ## Quick Start (Server)
 *
 * ```typescript
 * // In app/server.ts (once at startup)
 * import { initObservability } from '../lib/observability/index.js'
 * await initObservability()
 *
 * // In any server file
 * import { obs } from '../lib/observability/index.js'
 * const { logger, tracer, metrics } = obs('my-domain')
 *
 * await tracer.startSpan('my.operation', async (span) => {
 *   span.setAttribute('key', 'value')
 *   logger.info({ data: 123 }, 'Operation started')
 *   metrics.counter('my.counter').add(1)
 * })
 * ```
 *
 * ## CLI / Scripts
 *
 * ```typescript
 * import { createObservability } from '../lib/observability/index.js'
 *
 * const factory = createObservability({
 *   service: 'my-cli-tool',
 *   environment: 'development',
 *   telemetryEnabled: false,
 * })
 * await factory.init()
 * const { logger, tracer, metrics } = factory.create('cli')
 * ```
 */

// Re-export everything from submodules
export { ConsoleObservabilityFactory, PinoOtelObservabilityFactory } from './adapter.server.js'
// Re-export audit helpers
export {
  AuditAttributes,
  type AuditEventType,
  auditContextCompacted,
  auditInterruptReceived,
  auditLlmError,
  auditLlmRequest,
  auditLlmResponse,
  auditRunEnded,
  auditRunStarted,
  auditSessionEnded,
  auditSessionStarted,
  auditToolApproved,
  auditToolCached,
  auditToolCalled,
  auditToolDenied,
  auditToolFailed,
  auditToolSucceeded,
} from './audit.js'
// Re-export error classification
export {
  type ClassifiedError,
  classifyError,
  type ErrorCategory,
  getErrorSpanAttributes,
  getRetryDelay,
  isRetryableError,
} from './errors.js'
// Re-export health metrics
export { createHealthMetrics, HealthMetrics } from './health.js'
export type {
  Counter,
  Environment,
  Gauge,
  Histogram,
  HistogramOptions,
  LogLevel,
  Metrics,
  Observability,
  ObservabilityConfig,
  ObservabilityContext,
  ObservabilityFactory,
  Span,
  SpanAttributes,
  SpanLink,
  Tracer,
} from './types.js'
export {
  COMPLEXITY_BOUNDARIES,
  COST_BOUNDARIES,
  LATENCY_BOUNDARIES,
  SemanticAttributes,
  SemanticMetrics,
  SIZE_BOUNDARIES,
  SpanNames,
  TOKEN_BOUNDARIES,
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { ConsoleObservabilityFactory, PinoOtelObservabilityFactory } from './adapter.server.js'
import type {
  Observability,
  ObservabilityConfig,
  ObservabilityContext,
  ObservabilityFactory,
} from './types.js'

/**
 * Create an observability factory based on configuration.
 *
 * @example
 * // Full observability with OTEL
 * const factory = createObservability({
 *   service: 'letmesense',
 *   environment: 'production',
 *   telemetryEnabled: true,
 * })
 *
 * @example
 * // Simple console-only logging (for scripts)
 * const factory = createObservability({
 *   service: 'my-script',
 *   environment: 'development',
 *   telemetryEnabled: false,
 * })
 */
export function createObservability(config: ObservabilityConfig): ObservabilityFactory {
  // For console-only mode (no OTEL overhead) - use when telemetry explicitly disabled
  if (config.telemetryEnabled === false) {
    return new ConsoleObservabilityFactory({
      service: config.service,
      logLevel: config.logLevel,
    })
  }

  // Full Pino + OTEL
  return new PinoOtelObservabilityFactory(config)
}

/**
 * Create observability from environment variables.
 *
 * Reads:
 * - OTEL_SERVICE_NAME (default: 'letmesense')
 * - NODE_ENV (default: 'development')
 * - LOG_LEVEL (default: 'info' in prod, 'debug' in dev)
 * - OTEL_EXPORTER_OTLP_ENDPOINT: When set, enables OTEL export to this endpoint
 * - OTEL_SDK_DISABLED: Set to 'true' to disable OTEL (kill switch)
 */
export function createObservabilityFromEnv(): ObservabilityFactory {
  const environment = process.env.NODE_ENV ?? 'development'
  const isDev = environment === 'development'

  // Enable telemetry if endpoint is configured and not explicitly disabled
  const hasEndpoint = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  const isDisabled = process.env.OTEL_SDK_DISABLED === 'true'
  const telemetryEnabled = hasEndpoint && !isDisabled

  return createObservability({
    service: process.env.OTEL_SERVICE_NAME ?? 'letmesense',
    environment,
    logLevel: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    telemetryEnabled,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton for Server Usage
// ─────────────────────────────────────────────────────────────────────────────

let _factory: ObservabilityFactory | null = null
let _initialized = false

/**
 * Set the singleton observability factory.
 * Call this from CLI startup to register the factory before any obs() calls.
 *
 * @example
 * // cli/letmesense.ts
 * const factory = createObservability({ ... })
 * setObservabilityFactory(factory)
 * await factory.init()
 */
export function setObservabilityFactory(factory: ObservabilityFactory): void {
  _factory = factory
}

/**
 * Get the singleton observability factory.
 * Creates one from environment if not already created.
 */
export function getObservabilityFactory(): ObservabilityFactory {
  if (!_factory) {
    _factory = createObservabilityFromEnv()
  }
  return _factory
}

/**
 * Initialize the observability system.
 * Call this once at server startup (e.g., in app/server.ts).
 *
 * @example
 * // app/server.ts
 * import { initObservability } from '../lib/observability'
 * await initObservability()
 */
export async function initObservability(): Promise<void> {
  if (_initialized) return
  _initialized = true

  const factory = getObservabilityFactory()
  await factory.init()
}

/**
 * Shutdown the observability system gracefully.
 * Call this on server shutdown.
 */
export async function shutdownObservability(): Promise<void> {
  if (_factory) {
    await _factory.shutdown()
    _factory = null
    _initialized = false
  }
}

/**
 * Get observability instances for a specific domain.
 * Short alias for common usage pattern.
 *
 * @param domain - The domain name (e.g., 'ai', 'http', 'email')
 * @returns Observability instance with logger, tracer, and metrics
 *
 * @example
 * import { obs } from '../lib/observability'
 *
 * const { logger, tracer, metrics } = obs('ai')
 *
 * await tracer.startSpan('ai.generate', async (span) => {
 *   span.setAttribute('model', 'gpt-4')
 *   logger.info({ prompt: '...' }, 'Starting generation')
 *   // ... work
 *   metrics.counter('ai.requests').add(1)
 * })
 */
export function obs(domain: string): Observability {
  return getObservabilityFactory().create(domain)
}

/**
 * Create an observability context with correlation ID for end-to-end tracing.
 *
 * @param domain - The domain name (e.g., 'pipeline', 'ai')
 * @param correlationId - Optional correlation ID (generates UUID if not provided)
 * @returns ObservabilityContext with correlationId bound to logger
 *
 * @example
 * ```typescript
 * // At request entry point
 * const ctx = obsWithCorrelation('pipeline')
 * ctx.logger.info({ input }, 'Processing started')
 *
 * // Pass to child operations
 * await processDocument(input, { correlationId: ctx.correlationId })
 *
 * // In child operation, create context with same correlation ID
 * const childCtx = obsWithCorrelation('pdf', parentCorrelationId)
 * ```
 */
export function obsWithCorrelation(domain: string, correlationId?: string): ObservabilityContext {
  const id = correlationId ?? crypto.randomUUID()
  const base = obs(domain)

  return {
    correlationId: id,
    logger: base.logger.child({ correlationId: id }),
    tracer: base.tracer,
    metrics: base.metrics,
  }
}

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID()
}
