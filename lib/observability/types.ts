/**
 * Observability Interfaces
 *
 * Decoupled interfaces for logging, tracing, and metrics.
 * External tools depend on these, not on Pino/OpenTelemetry directly.
 *
 * Design decisions:
 * - Logger: Expose Pino directly (don't wrap - it's already well-designed)
 * - Tracer: Abstract to decouple from OpenTelemetry specifics
 * - Metrics: Abstract to decouple from OpenTelemetry specifics
 *
 * Signal naming conventions: see SIGNALS.md
 */
import type { Logger as PinoLogger } from 'pino'

// ─────────────────────────────────────────────────────────────────────────────
// Span & Tracer Interfaces (abstracted from OpenTelemetry)
// ─────────────────────────────────────────────────────────────────────────────

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined
}

export interface Span {
  /** Set a single attribute */
  setAttribute(key: string, value: string | number | boolean): void
  /** Set multiple attributes */
  setAttributes(attributes: SpanAttributes): void
  /** Record an exception on this span */
  recordException(error: Error): void
  /** Mark span as error with message */
  setError(message: string): void
  /** Add a timestamped event to the span (for audit trail) */
  addEvent(name: string, attributes?: SpanAttributes): void
  /** End the span */
  end(): void
}

export interface Tracer {
  /**
   * Start a new span and execute a function within it.
   * Span is automatically ended after the function completes.
   * Exceptions are automatically recorded on the span.
   */
  startSpan<T>(name: string, fn: (span: Span) => Promise<T> | T): Promise<T>
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Interfaces (abstracted from OpenTelemetry)
// ─────────────────────────────────────────────────────────────────────────────

export interface Counter {
  /** Increment counter by value */
  add(value: number, labels?: Record<string, string>): void
}

export interface Histogram {
  /** Record a value in the histogram */
  record(value: number, labels?: Record<string, string>): void
}

/** Options for creating a histogram with custom boundaries */
export interface HistogramOptions {
  /** Explicit bucket boundaries for SLI/SLO analysis */
  boundaries?: number[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Histogram Boundaries (SLI/SLO Support)
// ─────────────────────────────────────────────────────────────────────────────

/** Default latency boundaries in milliseconds for duration/latency histograms */
export const LATENCY_BOUNDARIES = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]

/** Default size boundaries in bytes for size/bytes histograms */
export const SIZE_BOUNDARIES = [1024, 10240, 102400, 1048576, 10485760] // 1KB to 10MB

/** Default token boundaries for LLM token count histograms */
export const TOKEN_BOUNDARIES = [100, 500, 1000, 2000, 4000, 8000, 16000, 32000]

/** Default complexity score boundaries (0-100) */
export const COMPLEXITY_BOUNDARIES = [10, 20, 30, 50, 70, 90]

/** Default cost boundaries in USD */
export const COST_BOUNDARIES = [0.001, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0]

export interface Gauge {
  /** Set the gauge value */
  set(value: number, labels?: Record<string, string>): void
  /** Get the current gauge value (returns 0 if not set) */
  get(): number
}

export interface Metrics {
  /** Get or create a counter */
  counter(name: string): Counter
  /** Get or create a histogram with optional custom boundaries */
  histogram(name: string, options?: HistogramOptions): Histogram
  /** Get or create a gauge */
  gauge(name: string): Gauge
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined Observability Context
// ─────────────────────────────────────────────────────────────────────────────

export interface Observability {
  /** Pino logger with full API (child loggers, redaction, etc.) */
  logger: PinoLogger
  /** Tracer for creating spans */
  tracer: Tracer
  /** Metrics for counters and histograms */
  metrics: Metrics
}

/**
 * Observability context with correlation ID for end-to-end request tracing.
 * Use this when you need to propagate a correlation ID through multiple operations.
 */
export interface ObservabilityContext extends Observability {
  /** Unique correlation ID for tracing requests across services */
  correlationId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Pino log levels */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/** Deployment environments */
export type Environment = 'development' | 'staging' | 'production' | 'test'

export interface ObservabilityConfig {
  /** Service name for telemetry */
  service: string
  /** Deployment environment */
  environment: Environment | (string & {})
  /** Log level */
  logLevel?: LogLevel | (string & {})
  /** Paths to redact from logs */
  redact?: string[]
  /** Enable telemetry (traces, metrics, OTEL logs export) */
  telemetryEnabled?: boolean
  /**
   * Use console exporters instead of OTLP.
   * When true, traces go to stdout for quick debugging.
   * When false (default), uses OTLP exporters (requires OTEL_EXPORTER_OTLP_ENDPOINT).
   */
  consoleExporter?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface ObservabilityFactory {
  /** Create observability context for a domain */
  create(domain: string): Observability
  /** Initialize telemetry (call once at startup) */
  init(): Promise<void>
  /** Shutdown telemetry gracefully */
  shutdown(): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic Attributes (cross-cutting span attribute keys)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cross-cutting span attribute keys used across multiple modules.
 *
 * Only attributes that appear in 2+ modules belong here.
 * Module-local attributes (e.g. `pageNumber`, `hasAlpha`)
 * stay as inline strings at the call site.
 */
export const SemanticAttributes = {
  // Identity
  MODEL: 'model',
  PROVIDER: 'provider',
  FORMAT: 'format',
  LANGUAGE: 'language',
  SOURCE: 'source',
  INPUT_TYPE: 'input.type',
  CORRELATION_ID: 'correlation.id',

  // LLM tokens
  INPUT_TOKENS: 'input.tokens',
  OUTPUT_TOKENS: 'output.tokens',
  TOTAL_INPUT_TOKENS: 'total.input.tokens',
  TOTAL_OUTPUT_TOKENS: 'total.output.tokens',

  // Cost (span attributes)
  COST_INPUT_USD: 'cost.input.usd',
  COST_OUTPUT_USD: 'cost.output.usd',
  COST_TOTAL_USD: 'cost.total.usd',

  // Sizing
  BYTES: 'bytes',
  CHAR_COUNT: 'char.count',
  UNIT_COUNT: 'unit.count',
  UNIT_INDEX: 'unit.index',
  RUN_COUNT: 'run.count',
  PAGE_COUNT: 'page.count',

  // Rendering / extraction
  METHOD: 'method',
  CONFIDENCE: 'confidence',
  SCALE: 'scale',
  WIDTH: 'width',
  HEIGHT: 'height',

  // Lifecycle
  DURATION_MS: 'duration_ms',
  ERROR_COUNT: 'error.count',
  STATUS: 'status',
  STREAMING: 'streaming',

  // Retry
  ATTEMPTS: 'attempts',
  SUCCESS: 'success',
} as const
