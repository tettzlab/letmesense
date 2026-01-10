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

/**
 * Span link for connecting related spans (e.g., retries to parent)
 */
export interface SpanLink {
  /** Trace ID of the linked span */
  traceId: string
  /** Span ID of the linked span */
  spanId: string
  /** Optional attributes for the link */
  attributes?: SpanAttributes
}

export interface Tracer {
  /**
   * Start a new span and execute a function within it.
   * Span is automatically ended after the function completes.
   * Exceptions are automatically recorded on the span.
   */
  startSpan<T>(name: string, fn: (span: Span) => Promise<T> | T): Promise<T>

  /**
   * Start a new span with links to related spans.
   * Useful for linking retry attempts to the original request.
   */
  startSpanWithLinks?<T>(
    name: string,
    links: SpanLink[],
    fn: (span: Span) => Promise<T> | T,
  ): Promise<T>

  /**
   * Get the current span context for creating links.
   * Returns undefined if no active span.
   */
  getCurrentSpanContext?(): SpanLink | undefined
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
// Span Names (constants for consistency)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Span name constants for consistent tracing across all domains.
 * Pattern: {domain}.{operation} or {domain}.{subdomain}.{operation}
 */
export const SpanNames = {
  // Session & Agent
  SESSION: 'session',
  RUN: 'run',
  LLM_REQUEST: 'llm.request',
  TOOL_EXECUTION: 'tool.execution',
  TOOL_APPROVAL: 'tool.approval',
  CONTEXT_COMPACTION: 'context.compaction',
  SUBAGENT_RUN: 'subagent.run',

  // Pipeline
  PIPELINE_EXTRACT: 'pipeline.extract',
  PIPELINE_LOAD: 'pipeline.load',
  PIPELINE_PARSE: 'pipeline.parse',
  PIPELINE_ANALYZE: 'pipeline.analyze',
  PIPELINE_CLASSIFY: 'pipeline.classify',
  PIPELINE_EXTRACT_RUNS: 'pipeline.extractRuns',
  PIPELINE_VISION_LOAD: 'pipeline.vision.load',
  PIPELINE_VISION_PARSE: 'pipeline.vision.parse',
  PIPELINE_VISION_RENDER: 'pipeline.vision.render',
  PIPELINE_VISION_ANALYZE: 'pipeline.vision.analyze',
  PIPELINE_VISION_EXTRACT: 'pipeline.vision.extract',

  // PDF Plugin
  PDF_PLUGIN_LOAD: 'pdf.plugin.load',
  PDF_PLUGIN_PARSE: 'pdf.plugin.parse',
  PDF_PLUGIN_ANALYZE_UNIT: 'pdf.plugin.analyzeUnit',
  PDF_PLUGIN_EXTRACT_UNIT: 'pdf.plugin.extractUnit',
  PDF_PLUGIN_RENDER_UNIT: 'pdf.plugin.renderUnit',

  // Office Plugin
  OFFICE_PLUGIN_LOAD: 'office.plugin.load',
  OFFICE_PLUGIN_PARSE: 'office.plugin.parse',
  OFFICE_PLUGIN_ANALYZE_UNIT: 'office.plugin.analyzeUnit',
  OFFICE_PLUGIN_EXTRACT_UNIT: 'office.plugin.extractUnit',
  OFFICE_PLUGIN_RENDER_UNIT: 'office.plugin.renderUnit',

  // Image Plugin
  IMAGE_PLUGIN_LOAD: 'image.plugin.load',
  IMAGE_PLUGIN_PARSE: 'image.plugin.parse',
  IMAGE_PLUGIN_ANALYZE_UNIT: 'image.plugin.analyzeUnit',
  IMAGE_PLUGIN_EXTRACT_UNIT: 'image.plugin.extractUnit',
  IMAGE_PLUGIN_RENDER_UNIT: 'image.plugin.renderUnit',

  // ─────────────────────────────────────────────────────────────────────────
  // Utility Spans (Phase 4)
  // ─────────────────────────────────────────────────────────────────────────

  // OCR Utility
  OCR_WORKER_CREATE: 'ocr.worker.create',
  OCR_RECOGNIZE: 'ocr.recognize',
  OCR_RECOGNIZE_WITH_WORKER: 'ocr.recognizeWithWorker',

  // Image Utility
  IMAGE_VIEW: 'image.view',
  IMAGES_ANALYZE: 'images.analyze',

  // AI Core
  AI_FORMAT: 'ai.format',
  AI_FORMAT_PAGE: 'ai.format.page',
  AI_RETRY: 'ai.retry',

  // PDF Utility
  PDF_LOAD_DOCUMENT: 'pdf.loadDocument',
  PDF_ANALYZE_PAGE: 'pdf.analyzePage',
  PDF_RENDER_PAGE: 'pdf.renderPage',
  PDF_RENDER_ALL_PAGES: 'pdf.renderAllPages',
  PDF_SPLIT: 'pdf.split',
  PDF_OCR: 'pdf.ocr',
  PDF_EXTRACT: 'pdf.extract',

  // Office Utility
  OFFICE_LOAD_DOCUMENT: 'office.loadDocument',
  OFFICE_PARSE_FILE: 'office.parseFile',
  OFFICE_PARSE_BUFFER: 'office.parseBuffer',
  OFFICE_TEXT_EXTRACT: 'office.text.extract',
  OFFICE_EXTRACT: 'office.extract',
  OFFICE_LOAD: 'office.load',
  OFFICE_PARSE: 'office.parse',
  OFFICE_ANALYZE: 'office.analyze',

  // Office LibreOffice
  OFFICE_LIBREOFFICE_CONVERT: 'office.libreoffice.convert',
  OFFICE_LIBREOFFICE_CONVERT_WITH_PROFILE: 'office.libreoffice.convertWithProfile',

  // Office Vision Utility
  OFFICE_VISION_CONVERT_TO_PDF: 'office.vision.convertToPdf',
  OFFICE_VISION_RENDER_TO_IMAGES: 'office.vision.renderToImages',
  OFFICE_VISION_FORMAT: 'office.vision.format',

  // Office Plugin (missed in Phase 2)
  OFFICE_PLUGIN_CONVERT_TO_PDF: 'office.plugin.convertToPdf',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// OpenTelemetry Semantic Convention Attribute Names
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attribute names aligned with OpenTelemetry Semantic Conventions.
 * Use these constants for consistent span attribute naming.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/
 */
export const SemanticAttributes = {
  // Gen AI / LLM Attributes (align with gen_ai conventions)
  GEN_AI_SYSTEM: 'gen_ai.system',
  GEN_AI_REQUEST_MODEL: 'gen_ai.request.model',
  GEN_AI_RESPONSE_MODEL: 'gen_ai.response.model',
  GEN_AI_USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  GEN_AI_USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',

  // Document Attributes
  DOCUMENT_TYPE: 'document.type',
  DOCUMENT_FORMAT: 'document.format',
  DOCUMENT_PAGE_COUNT: 'document.page.count',
  DOCUMENT_CHAR_COUNT: 'document.char.count',
  DOCUMENT_SIZE_BYTES: 'document.size.bytes',
  DOCUMENT_IMAGE_COUNT: 'document.image.count',
  DOCUMENT_HAS_OCR: 'document.has_ocr',
  DOCUMENT_HAS_MIXED_CONTENT: 'document.has_mixed_content',
  DOCUMENT_COMPLEXITY_SCORE: 'document.complexity.score',

  // Error Attributes
  ERROR_TYPE: 'error.type',
  ERROR_MESSAGE: 'error.message',
  ERROR_CATEGORY: 'error.category',
  ERROR_RETRYABLE: 'error.retryable',
  ERROR_STATUS_CODE: 'error.status_code',

  // Cost Attributes (custom)
  AI_COST_INPUT_USD: 'ai.cost.input.usd',
  AI_COST_OUTPUT_USD: 'ai.cost.output.usd',
  AI_COST_TOTAL_USD: 'ai.cost.total.usd',

  // Correlation
  CORRELATION_ID: 'correlation.id',
} as const

/**
 * Metric names aligned with OpenTelemetry Semantic Conventions.
 * Pattern: {domain}.{entity}.{measurement}[.{unit}]
 *
 * Naming rules:
 * - Counters: end with `.count`
 * - Histograms: end with `_ms`, `_bytes`, `.score`, `.chars`, or `.count` (for distributions)
 * - Gauges: descriptive name (`.active`, `.depth`, etc.)
 */
export const SemanticMetrics = {
  // ─────────────────────────────────────────────────────────────────────────
  // CLI Metrics
  // ─────────────────────────────────────────────────────────────────────────
  CLI_COMMANDS_COUNT: 'cli.commands.count',
  CLI_DURATION_MS: 'cli.duration_ms',

  // ─────────────────────────────────────────────────────────────────────────
  // AI/LLM Metrics
  // ─────────────────────────────────────────────────────────────────────────
  AI_REQUEST_COUNT: 'ai.request.count',
  AI_REQUEST_DURATION_MS: 'ai.request.duration_ms',
  AI_TOKEN_INPUT_COUNT: 'ai.token.input.count',
  AI_TOKEN_OUTPUT_COUNT: 'ai.token.output.count',
  AI_COST_USD: 'ai.cost.usd',
  AI_COST_TOTAL_USD: 'ai.cost.total.usd',

  // AI Retry Metrics
  AI_RETRY_ATTEMPTS: 'ai.retry.attempts',
  AI_RETRY_SUCCESSES: 'ai.retry.successes',
  AI_RETRY_FAILURES: 'ai.retry.failures',
  AI_RETRY_EXHAUSTED: 'ai.retry.exhausted',
  AI_RETRY_TOTAL_DELAY_MS: 'ai.retry.totalDelayMs',

  // ─────────────────────────────────────────────────────────────────────────
  // Pipeline Metrics
  // ─────────────────────────────────────────────────────────────────────────
  PIPELINE_EXTRACTIONS_COUNT: 'pipeline.extractions.count',
  PIPELINE_RUNS_COUNT: 'pipeline.runs.count',
  PIPELINE_UNITS_COUNT: 'pipeline.units.count',
  PIPELINE_ERRORS_COUNT: 'pipeline.errors.count',
  PIPELINE_EXTRACTION_DURATION_MS: 'pipeline.extraction.duration_ms',
  PIPELINE_EXTRACTION_CHARS: 'pipeline.extraction.chars',
  PIPELINE_FORMAT_DETECTED_COUNT: 'pipeline.format.detected.count',

  // Pipeline Vision Metrics
  PIPELINE_VISION_EXTRACTIONS_COUNT: 'pipeline.vision.extractions.count',
  PIPELINE_VISION_UNITS_COUNT: 'pipeline.vision.units.count',
  PIPELINE_VISION_ERRORS_COUNT: 'pipeline.vision.errors.count',
  PIPELINE_VISION_EXTRACTION_DURATION_MS: 'pipeline.vision.extraction.duration_ms',
  PIPELINE_VISION_EXTRACTION_CHARS: 'pipeline.vision.extraction.chars',
  PIPELINE_VISION_UNIT_DURATION_MS: 'pipeline.vision.unit.duration_ms',
  PIPELINE_VISION_UNIT_CHARS: 'pipeline.vision.unit.chars',

  // ─────────────────────────────────────────────────────────────────────────
  // Document Metrics
  // ─────────────────────────────────────────────────────────────────────────
  DOCUMENT_LOAD_COUNT: 'document.load.count',
  DOCUMENT_LOAD_BYTES: 'document.load.bytes',
  DOCUMENT_COMPLEXITY_SCORE: 'document.complexity.score',
  DOCUMENT_PAGE_COUNT: 'document.page.count',

  // ─────────────────────────────────────────────────────────────────────────
  // PDF Plugin Metrics
  // ─────────────────────────────────────────────────────────────────────────
  PDF_PLUGIN_LOADS_COUNT: 'pdf.plugin.loads.count',
  PDF_PLUGIN_LOAD_BYTES: 'pdf.plugin.load.bytes',
  PDF_PLUGIN_UNITS_COUNT: 'pdf.plugin.units.count',
  PDF_PLUGIN_ANALYZE_PAGES_COUNT: 'pdf.plugin.analyze.pages.count',
  PDF_PLUGIN_EXTRACT_PAGES_COUNT: 'pdf.plugin.extract.pages.count',
  PDF_PLUGIN_EXTRACT_CHARS: 'pdf.plugin.extract.chars',
  PDF_PLUGIN_RENDER_PAGES_COUNT: 'pdf.plugin.render.pages.count',
  PDF_PLUGIN_RENDER_BYTES: 'pdf.plugin.render.bytes',

  // PDF Utility Metrics
  PDF_DOCUMENTS_LOADED_COUNT: 'pdf.documents.loaded.count',
  PDF_DOCUMENT_BYTES: 'pdf.document.bytes',
  PDF_PAGES_ANALYZED_COUNT: 'pdf.pages.analyzed.count',
  PDF_PAGES_RENDERED_COUNT: 'pdf.pages.rendered.count',
  PDF_RENDER_BYTES: 'pdf.render.bytes',
  PDF_RENDER_ALL_BYTES: 'pdf.renderAll.bytes',
  PDF_CLASSIFICATION_COUNT: 'pdf.classification.count',
  PDF_TEXT_EXTRACT_DURATION_MS: 'pdf.text.extract.duration_ms',
  PDF_EXTRACTIONS_COUNT: 'pdf.extractions.count',
  PDF_EXTRACTION_DURATION_MS: 'pdf.extraction.duration_ms',
  PDF_PAGES_COUNT: 'pdf.pages.count',
  PDF_OCR_PAGES_COUNT: 'pdf.ocr.pages.count',

  // ─────────────────────────────────────────────────────────────────────────
  // Office Plugin Metrics
  // ─────────────────────────────────────────────────────────────────────────
  OFFICE_PLUGIN_LOADS_COUNT: 'office.plugin.loads.count',
  OFFICE_PLUGIN_LOAD_BYTES: 'office.plugin.load.bytes',
  OFFICE_PLUGIN_UNITS_COUNT: 'office.plugin.units.count',
  OFFICE_PLUGIN_ANALYZE_UNITS_COUNT: 'office.plugin.analyze.units.count',
  OFFICE_PLUGIN_EXTRACT_UNITS_COUNT: 'office.plugin.extract.units.count',
  OFFICE_PLUGIN_EXTRACT_CHARS: 'office.plugin.extract.chars',
  OFFICE_PLUGIN_PDF_CONVERSIONS_COUNT: 'office.plugin.pdf.conversions.count',
  OFFICE_PLUGIN_RENDER_UNITS_COUNT: 'office.plugin.render.units.count',
  OFFICE_PLUGIN_RENDER_BYTES: 'office.plugin.render.bytes',

  // Office Utility Metrics
  OFFICE_DOCUMENTS_LOADED_COUNT: 'office.documents.loaded.count',
  OFFICE_DOCUMENT_BYTES: 'office.document.bytes',
  OFFICE_DOCUMENTS_PARSED_COUNT: 'office.documents.parsed.count',
  OFFICE_CLASSIFICATION_COUNT: 'office.classification.count',
  OFFICE_CLASSIFICATION_COVERAGE_COUNT: 'office.classification.coverage.count',
  OFFICE_TEXT_EXTRACT_COUNT: 'office.text.extract.count',
  OFFICE_TEXT_EXTRACT_DURATION_MS: 'office.text.extract.duration_ms',
  OFFICE_FORMAT_COUNT: 'office.format.count',
  OFFICE_FORMAT_DURATION_MS: 'office.format.duration_ms',
  OFFICE_EXTRACTIONS_COUNT: 'office.extractions.count',
  OFFICE_EXTRACTION_DURATION_MS: 'office.extraction.duration_ms',
  OFFICE_UNITS_COUNT: 'office.units.count',

  // Office LibreOffice Conversion
  OFFICE_LIBREOFFICE_CONVERSIONS_COUNT: 'office.libreoffice.conversions.count',
  OFFICE_LIBREOFFICE_CONVERSIONS_PROFILE_COUNT: 'office.libreoffice.conversions.profile.count',
  OFFICE_LIBREOFFICE_DURATION_MS: 'office.libreoffice.duration_ms',

  // Office Vision Metrics
  OFFICE_VISION_RENDER_COUNT: 'office.vision.render.count',
  OFFICE_VISION_RENDER_DURATION_MS: 'office.vision.render.duration_ms',
  OFFICE_VISION_PROCESS_COUNT: 'office.vision.process.count',
  OFFICE_VISION_PROCESS_DURATION_MS: 'office.vision.process.duration_ms',

  // ─────────────────────────────────────────────────────────────────────────
  // Image Plugin Metrics
  // ─────────────────────────────────────────────────────────────────────────
  IMAGE_PLUGIN_LOADS_COUNT: 'image.plugin.loads.count',
  IMAGE_PLUGIN_LOAD_BYTES: 'image.plugin.load.bytes',
  IMAGE_PLUGIN_UNITS_COUNT: 'image.plugin.units.count',
  IMAGE_PLUGIN_ANALYZE_UNITS_COUNT: 'image.plugin.analyze.units.count',
  IMAGE_PLUGIN_EXTRACT_UNITS_COUNT: 'image.plugin.extract.units.count',
  IMAGE_PLUGIN_RENDER_UNITS_COUNT: 'image.plugin.render.units.count',

  // Image Utility Metrics
  IMAGE_LOAD_COUNT: 'image.load.count',
  IMAGE_LOAD_BYTES: 'image.load.bytes',
  IMAGE_PROCESS_DURATION_MS: 'image.process.duration_ms',
  IMAGE_RESIZE_COUNT: 'image.resize.count',
  IMAGES_ANALYSES_COUNT: 'images.analyses.count',
  IMAGES_ANALYSIS_DURATION_MS: 'images.analysis.duration_ms',

  // ─────────────────────────────────────────────────────────────────────────
  // OCR Metrics
  // ─────────────────────────────────────────────────────────────────────────
  OCR_RECOGNITIONS_COUNT: 'ocr.recognitions.count',
  OCR_CONFIDENCE: 'ocr.confidence',
  OCR_WORKERS_CREATED_COUNT: 'ocr.workers.created.count',
  OCR_WORKERS_TERMINATED_COUNT: 'ocr.workers.terminated.count',
  OCR_TESSDATA_LOADS_COUNT: 'ocr.tessdata.loads.count',

  // ─────────────────────────────────────────────────────────────────────────
  // LibreOffice Pool Metrics
  // ─────────────────────────────────────────────────────────────────────────
  LIBREOFFICE_POOL_ACTIVE: 'libreoffice.pool.active',
  LIBREOFFICE_POOL_QUEUE_DEPTH: 'libreoffice.pool.queue.depth',
  LIBREOFFICE_POOL_JOBS_TOTAL_COUNT: 'libreoffice.pool.jobs.total.count',
  LIBREOFFICE_POOL_JOB_DURATION_MS: 'libreoffice.pool.job.duration_ms',

  // ─────────────────────────────────────────────────────────────────────────
  // Error Metrics
  // ─────────────────────────────────────────────────────────────────────────
  ERROR_COUNT: 'error.count',
} as const
