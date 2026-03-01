/**
 * Observability Adapter
 *
 * Bridges our abstract interfaces to Pino + OpenTelemetry implementations.
 * This file is the only place that knows about the concrete implementations.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { metrics, type Tracer as OtelTracer, SpanStatusCode, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import pino, { type Logger as PinoLogger } from 'pino'
import { build as buildPrettyStream } from 'pino-pretty'
import type {
  Counter,
  Gauge,
  Histogram,
  HistogramOptions,
  Metrics,
  Observability,
  ObservabilityConfig,
  ObservabilityFactory,
  Span,
  SpanAttributes,
  Tracer,
} from './types.js'
import {
  COMPLEXITY_BOUNDARIES,
  COST_BOUNDARIES,
  LATENCY_BOUNDARIES,
  SIZE_BOUNDARIES,
  TOKEN_BOUNDARIES,
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Span Adapter (wraps OpenTelemetry Span)
// ─────────────────────────────────────────────────────────────────────────────

class OtelSpanAdapter implements Span {
  constructor(private otelSpan: import('@opentelemetry/api').Span) {}

  setAttribute(key: string, value: string | number | boolean): void {
    this.otelSpan.setAttribute(key, value)
  }

  setAttributes(attributes: SpanAttributes): void {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) {
        this.otelSpan.setAttribute(key, value)
      }
    }
  }

  recordException(error: Error): void {
    this.otelSpan.recordException(error)
  }

  setError(message: string): void {
    this.otelSpan.setStatus({ code: SpanStatusCode.ERROR, message })
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    this.otelSpan.addEvent(name, attributes)
  }

  end(): void {
    this.otelSpan.end()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracer Adapter (wraps OpenTelemetry Tracer)
// ─────────────────────────────────────────────────────────────────────────────

class OtelTracerAdapter implements Tracer {
  constructor(private otelTracer: OtelTracer) {}

  async startSpan<T>(name: string, fn: (span: Span) => Promise<T> | T): Promise<T> {
    return this.otelTracer.startActiveSpan(name, async (otelSpan) => {
      const span = new OtelSpanAdapter(otelSpan)
      try {
        return await fn(span)
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)))
        span.setError(String(error))
        throw error
      } finally {
        span.end()
      }
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Adapter (wraps OpenTelemetry Meter)
// ─────────────────────────────────────────────────────────────────────────────

/** Create a cache key for gauge values with labels */
function makeGaugeKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name
  const sortedLabels = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return `${name}|${sortedLabels}`
}

class OtelMetricsAdapter implements Metrics {
  private counters = new Map<string, Counter>()
  private histograms = new Map<string, Histogram>()
  private gauges = new Map<string, Gauge>()
  /** Stores gauge values with their labels: Map<cacheKey, { value, labels }> */
  private gaugeValues = new Map<string, { value: number; labels?: Record<string, string> }>()
  private meter: ReturnType<typeof metrics.getMeter>

  constructor(service: string) {
    this.meter = metrics.getMeter(service)
  }

  counter(name: string): Counter {
    const existing = this.counters.get(name)
    if (existing) return existing

    const otelCounter = this.meter.createCounter(name)
    const counter: Counter = {
      add: (value, labels) => otelCounter.add(value, labels),
    }
    this.counters.set(name, counter)
    return counter
  }

  histogram(name: string, options?: HistogramOptions): Histogram {
    const existing = this.histograms.get(name)
    if (existing) return existing

    // Determine bucket boundaries
    const boundaries = options?.boundaries ?? this.inferBoundaries(name)

    const otelHistogram = this.meter.createHistogram(name, {
      advice: boundaries ? { explicitBucketBoundaries: boundaries } : undefined,
    })
    const histogram: Histogram = {
      record: (value, labels) => otelHistogram.record(value, labels),
    }
    this.histograms.set(name, histogram)
    return histogram
  }

  /**
   * Infer appropriate histogram boundaries from metric name.
   */
  private inferBoundaries(name: string): number[] | undefined {
    const lowerName = name.toLowerCase()

    // Duration/latency metrics (in milliseconds)
    if (
      lowerName.includes('duration') ||
      lowerName.includes('latency') ||
      lowerName.includes('_ms')
    ) {
      return LATENCY_BOUNDARIES
    }

    // Size metrics (in bytes)
    if (lowerName.includes('bytes') || lowerName.includes('size')) {
      return SIZE_BOUNDARIES
    }

    // Token metrics
    if (lowerName.includes('token')) {
      return TOKEN_BOUNDARIES
    }

    // Complexity score
    if (lowerName.includes('complexity')) {
      return COMPLEXITY_BOUNDARIES
    }

    // Cost metrics (in USD)
    if (lowerName.includes('cost')) {
      return COST_BOUNDARIES
    }

    // No specific boundaries - use OpenTelemetry defaults
    return undefined
  }

  gauge(name: string): Gauge {
    const existing = this.gauges.get(name)
    if (existing) return existing

    // Store values locally and use ObservableGauge to report them
    // Note: OTEL ObservableGauge requires a callback that gets called during metric collection
    const observableGauge = this.meter.createObservableGauge(name)
    observableGauge.addCallback(
      (observableResult: {
        observe: (value: number, attributes?: Record<string, string>) => void
      }) => {
        // Report all values for this gauge (with different label combinations)
        for (const [key, entry] of this.gaugeValues) {
          if (key === name || key.startsWith(`${name}|`)) {
            observableResult.observe(entry.value, entry.labels)
          }
        }
      },
    )

    const gauge: Gauge = {
      set: (value, labels) => {
        const key = makeGaugeKey(name, labels)
        this.gaugeValues.set(key, { value, labels })
      },
      get: () => {
        // Return the unlabeled value (default case)
        return this.gaugeValues.get(name)?.value ?? 0
      },
    }
    this.gauges.set(name, gauge)
    return gauge
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Noop Implementations (for when telemetry is disabled)
// ─────────────────────────────────────────────────────────────────────────────

class NoopSpan implements Span {
  setAttribute(): void {}
  setAttributes(): void {}
  recordException(): void {}
  setError(): void {}
  addEvent(): void {}
  end(): void {}
}

class NoopTracer implements Tracer {
  async startSpan<T>(_name: string, fn: (span: Span) => Promise<T> | T): Promise<T> {
    return fn(new NoopSpan())
  }
}

class NoopMetrics implements Metrics {
  counter(): Counter {
    return { add: () => {} }
  }
  histogram(_name: string, _options?: HistogramOptions): Histogram {
    return { record: () => {} }
  }
  gauge(): Gauge {
    return { set: () => {}, get: () => 0 }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pino + OTEL Factory Implementation
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_REDACT_PATHS = [
  // Direct sensitive fields
  'password',
  'secret',
  'token',
  'authorization',
  'apiKey',
  'api_key',
  'accessToken',
  'refreshToken',
  'privateKey',
  'private_key',
  'credential',
  'credentials',
  // PII fields (email addresses)
  'email',
  'to',
  'recipient',
  // Nested sensitive fields (wildcard)
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.accessToken',
  '*.refreshToken',
  '*.privateKey',
  '*.private_key',
  '*.credential',
  '*.credentials',
  // Nested PII fields (wildcard)
  '*.email',
  '*.to',
  '*.recipient',
  // HTTP headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  // Input/output fields that might contain secrets
  'input.password',
  'input.secret',
  'input.token',
  'input.apiKey',
  'input.content', // Tool inputs may contain sensitive data
]

export class PinoOtelObservabilityFactory implements ObservabilityFactory {
  private config: ObservabilityConfig
  private rootLogger: PinoLogger
  private pinoTransport: pino.DestinationStream | null = null
  private sdk: NodeSDK | null = null
  private loggerProvider: LoggerProvider | null = null
  private initialized = false
  private tracerAdapter: Tracer
  private metricsAdapter: Metrics

  constructor(config: ObservabilityConfig) {
    this.config = config
    const isDev = config.environment === 'development'

    // Build transport targets
    const targets: pino.TransportTargetOptions[] = []

    // Target 1: JSON to stdout (always - for container logs)
    targets.push({
      target: 'pino/file',
      options: { destination: 1 }, // stdout
      level: config.logLevel ?? 'info',
    })

    // Target 2: Pretty print in dev (to stderr for separation)
    if (isDev) {
      targets.push({
        target: 'pino-pretty',
        options: {
          colorize: true,
          destination: 2, // stderr
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
        level: 'debug',
      })
    }

    // Target 3: OTEL log bridge (OTLP mode only - console mode logs go to stdout via Pino)
    if (config.telemetryEnabled && !config.consoleExporter) {
      try {
        const transportPath = fileURLToPath(
          new URL('./transports/otel-log-transport.js', import.meta.url),
        )
        // Only add transport if compiled JS file exists (may not exist in test environment)
        if (fs.existsSync(transportPath)) {
          targets.push({
            target: transportPath,
            options: {},
            level: config.logLevel ?? 'info',
          })
        }
      } catch {
        // In test environments, import.meta.url may not be a file:// URL
        // Skip the OTEL log transport in such cases
      }
    }

    // Create transport explicitly so we can close it in shutdown()
    this.pinoTransport = pino.transport({ targets })

    // Create root Pino logger with all batteries
    this.rootLogger = pino(
      {
        level: config.logLevel ?? (isDev ? 'debug' : 'info'),

        // Redaction - Pino's killer feature for security
        redact: config.redact ?? DEFAULT_REDACT_PATHS,

        // Serializers for common objects
        serializers: {
          err: pino.stdSerializers.err,
          error: pino.stdSerializers.err,
          req: pino.stdSerializers.req,
          res: pino.stdSerializers.res,
        },

        // Base bindings for all logs
        base: {
          service: config.service,
          env: config.environment,
        },
      },
      this.pinoTransport,
    )

    // Initialize tracer/metrics adapters (noop until init() is called)
    this.tracerAdapter = new NoopTracer()
    this.metricsAdapter = new NoopMetrics()
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    // If telemetry is disabled, keep noop adapters
    if (!this.config.telemetryEnabled) {
      this.rootLogger.info('Telemetry disabled, using noop tracer/metrics')
      return
    }

    // Console mode: output to stdout for quick debugging (--observe flag)
    // OTLP mode: send to collector (OTEL_EXPORTER_OTLP_ENDPOINT env var)
    const useConsole = this.config.consoleExporter === true

    // Warn if OTLP mode enabled without endpoint configured
    if (!useConsole && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      this.rootLogger.warn(
        'OTLP mode enabled but OTEL_EXPORTER_OTLP_ENDPOINT not set, traces may be lost',
      )
    }

    // Trace exporter: console for quick dev, OTLP for full observability
    const traceExporter = useConsole ? new ConsoleSpanExporter() : new OTLPTraceExporter()
    const spanProcessor = useConsole
      ? new SimpleSpanProcessor(traceExporter)
      : new BatchSpanProcessor(traceExporter as OTLPTraceExporter)

    // Metrics exporter (OTLP only - no console equivalent)
    const metricReader = useConsole
      ? undefined
      : new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: 60000,
        })

    // Shared resource for all OTEL signals (traces, metrics, logs)
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: this.config.service,
      [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? 'dev',
      'deployment.environment': this.config.environment,
    })

    // Setup LoggerProvider for OTLP log export (skip in console mode - logs already go to stdout)
    if (!useConsole) {
      this.loggerProvider = new LoggerProvider({
        resource,
        processors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
      })
      // Register globally so the Pino transport can access it
      logs.setGlobalLoggerProvider(this.loggerProvider)
    }

    this.sdk = new NodeSDK({
      resource,
      spanProcessor,
      metricReader,
      instrumentations: [
        new HttpInstrumentation(),
        new PinoInstrumentation({
          logHook: (span, record) => {
            record.trace_id = span.spanContext().traceId
            record.span_id = span.spanContext().spanId
          },
        }),
      ],
    })

    this.sdk.start()

    // Now switch to real adapters
    this.tracerAdapter = new OtelTracerAdapter(trace.getTracer(this.config.service))
    this.metricsAdapter = new OtelMetricsAdapter(this.config.service)

    // Note: Signal handlers (SIGTERM/SIGINT) should be registered by the CLI entry point,
    // not here. The CLI calls observabilityFactory.shutdown() in its handler.

    this.rootLogger.info({ mode: useConsole ? 'console' : 'otlp' }, 'OpenTelemetry initialized')
  }

  async shutdown(): Promise<void> {
    // Shutdown LoggerProvider first to flush any pending logs
    if (this.loggerProvider) {
      await this.loggerProvider
        .shutdown()
        .catch((err) => this.rootLogger.error({ err }, 'LoggerProvider shutdown error'))
      this.loggerProvider = null
    }

    if (this.sdk) {
      await this.sdk
        .shutdown()
        .catch((err) => this.rootLogger.error({ err }, 'OTEL SDK shutdown error'))
      this.sdk = null
    }

    // Close Pino transport worker thread to allow process exit
    if (this.pinoTransport && 'end' in this.pinoTransport) {
      this.rootLogger.flush()
      ;(this.pinoTransport as { end: () => void }).end()
      this.pinoTransport = null
    }
  }

  create(domain: string): Observability {
    return {
      logger: this.rootLogger.child({ domain }),
      tracer: this.tracerAdapter,
      metrics: this.metricsAdapter,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Console-only Factory (for simple scripts without OTEL)
// ─────────────────────────────────────────────────────────────────────────────

export class ConsoleObservabilityFactory implements ObservabilityFactory {
  private rootLogger: PinoLogger
  private tracer: Tracer = new NoopTracer()
  private metrics: Metrics = new NoopMetrics()

  constructor(config: Pick<ObservabilityConfig, 'service' | 'logLevel'>) {
    // Use synchronous pino-pretty stream (no worker thread) to allow clean process exit
    const prettyStream = buildPrettyStream({ colorize: true, translateTime: 'HH:MM:ss' })
    this.rootLogger = pino(
      {
        level: config.logLevel ?? 'info',
        base: { service: config.service },
      },
      prettyStream,
    )
  }

  async init(): Promise<void> {
    // No-op for console-only
  }

  async shutdown(): Promise<void> {
    this.rootLogger.flush()
  }

  create(domain: string): Observability {
    return {
      logger: this.rootLogger.child({ domain }),
      tracer: this.tracer,
      metrics: this.metrics,
    }
  }
}
