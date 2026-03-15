/**
 * Pipeline processor for the unified extraction pipeline.
 * Orchestrates format plugins to extract text from documents.
 */

import { DEFAULT_FETCH_TIMEOUT_MS } from '../common/timeouts.js'
import { generateCorrelationId, obsWithCorrelation } from '../observability/index.js'
import type { Span } from '../observability/types.js'
import { SemanticAttributes } from '../observability/types.js'
import { computeComplexity, getComplexitySpanAttributes } from './complexity.js'
import { ExtractError, isAbortError, LoadError, throwIfAborted, wrapError } from './errors.js'
import type { FormatPlugin, LoadedDocument, ParsedDocument } from './plugin.js'
import { buildRuns, canRender, defaultBuildRunKey } from './plugin.js'
import { ProgressReporter } from './progress.js'
import {
  buildPromptForExtraction,
  type DocumentType,
  determineDocumentType,
  determineTextReliability,
  extractPreviousTail,
  PROMPTS,
  type PromptPreset,
  type TextReliability,
} from './prompts.js'
import {
  describeSource,
  getDefaultRegistry,
  getExtension,
  type PluginRegistry,
} from './registry.js'
import { Metrics, Spans } from './signals.js'
import type {
  DocumentInput,
  DocumentRun,
  DocumentUnit,
  ExtractAllOptions,
  ExtractedUnit,
  ExtractionResult,
  ExtractUnitsResult,
  FormatId,
  UnitError,
  VisionChunk,
  VisionExtractOptions,
} from './types.js'

// ============================================================================
// Pipeline Processor
// ============================================================================

/**
 * Context returned by prepareExtraction for use in extract/extractUnits.
 */
interface PreparedExtraction<U extends DocumentUnit> {
  format: FormatId
  plugin: FormatPlugin<U>
  doc: LoadedDocument
  analyzedUnits: U[]
  runs: DocumentRun<U>[]
  metadata?: Record<string, unknown>
}

/**
 * Mutable holder for cleanup references, populated as prepareExtraction progresses.
 * Ensures cleanup runs even if prepareExtraction fails after loading the document.
 */
interface CleanupHolder {
  format?: FormatId
  doc?: LoadedDocument
  plugin?: FormatPlugin
}

/**
 * Options for creating a pipeline processor.
 */
export interface ProcessorOptions {
  /** Plugin registry to use (defaults to global registry) */
  registry?: PluginRegistry
}

/**
 * Main pipeline processor.
 * Coordinates plugins to extract text from documents.
 */
export class PipelineProcessor {
  private registry: PluginRegistry

  constructor(options: ProcessorOptions = {}) {
    this.registry = options.registry ?? getDefaultRegistry()
  }

  /**
   * Extract text from a document.
   *
   * @param input - Document input (file path, URL, buffer, or stdin)
   * @param options - Extraction options
   * @returns Extraction result with text and metadata
   */
  async extract<U extends DocumentUnit = DocumentUnit>(
    input: DocumentInput,
    options: ExtractAllOptions = {},
  ): Promise<ExtractionResult> {
    const correlationId = generateCorrelationId()
    const { logger, tracer, metrics } = obsWithCorrelation('pipeline', correlationId)
    const progress = new ProgressReporter(options.onProgress)
    const source = describeSource(input)
    const errors: UnitError[] = []
    const startTime = performance.now()

    return tracer.startSpan(Spans.EXTRACT, async (span) => {
      span.setAttribute(SemanticAttributes.SOURCE, source)
      span.setAttribute(SemanticAttributes.CORRELATION_ID, correlationId)

      const holder: CleanupHolder = {}
      try {
        const { format, plugin, doc, analyzedUnits, runs, metadata } =
          await this.prepareExtraction<U>(
            input,
            options,
            { logger, tracer, metrics },
            progress,
            source,
            span,
            errors,
            holder,
          )

        if (analyzedUnits.length === 0) {
          return {
            text: '',
            source,
            format,
            unitCount: 0,
            runCount: 0,
            errors: [],
            metadata: options.includeMetadata ? metadata : undefined,
          }
        }

        // Extract text from runs
        progress.extractStart(runs.length)
        const separator = options.separator ?? '\n\n'
        const texts = await tracer.startSpan(Spans.EXTRACT_RUNS, async (extractSpan) => {
          extractSpan.setAttribute(SemanticAttributes.RUN_COUNT, runs.length)
          extractSpan.setAttribute('parallel', options.parallel ?? true)
          return this.extractRuns(runs, doc, plugin, options, progress, errors)
        })
        progress.extractDone(texts.join(separator).length)

        const text = texts.join(separator)

        this.recordExtractionMetrics(
          span,
          { logger, metrics },
          { source, format, analyzedUnits, runs, text, errors, startTime },
        )

        return {
          text,
          source,
          format,
          unitCount: analyzedUnits.length,
          runCount: runs.length,
          errors,
          metadata: options.includeMetadata ? metadata : undefined,
        }
      } catch (err) {
        if (!isAbortError(err) && holder.format) {
          metrics
            .counter(Metrics.EXTRACTION_COUNT)
            .add(1, { status: 'error', format: holder.format })
          logger.error({ err, source, format: holder.format }, 'Extraction failed')
        }
        throw err
      } finally {
        if (holder.doc && holder.plugin) {
          await this.cleanupDoc(holder.doc, holder.plugin)
        }
      }
    })
  }

  /**
   * Extract text from a document with individual units preserved.
   * Use this when per-unit processing is needed (e.g., LLM formatting).
   *
   * @param input - Document input (file path, URL, buffer, or stdin)
   * @param options - Extraction options
   * @returns Extraction result with individual unit texts
   */
  async extractUnits<U extends DocumentUnit = DocumentUnit>(
    input: DocumentInput,
    options: ExtractAllOptions = {},
  ): Promise<ExtractUnitsResult> {
    const correlationId = generateCorrelationId()
    const { logger, tracer, metrics } = obsWithCorrelation('pipeline', correlationId)
    const progress = new ProgressReporter(options.onProgress)
    const source = describeSource(input)
    const errors: UnitError[] = []
    const startTime = performance.now()

    return tracer.startSpan(Spans.EXTRACT, async (span) => {
      span.setAttribute(SemanticAttributes.SOURCE, source)
      span.setAttribute(SemanticAttributes.CORRELATION_ID, correlationId)
      span.setAttribute('extractUnits', true)

      const holder: CleanupHolder = {}
      try {
        const { format, plugin, doc, analyzedUnits, runs, metadata } =
          await this.prepareExtraction<U>(
            input,
            options,
            { logger, tracer, metrics },
            progress,
            source,
            span,
            errors,
            holder,
          )

        if (analyzedUnits.length === 0) {
          return {
            units: [],
            result: {
              text: '',
              source,
              format,
              unitCount: 0,
              runCount: 0,
              errors: [],
              metadata: options.includeMetadata ? metadata : undefined,
            },
          }
        }

        // Extract text from each unit individually
        progress.extractStart(runs.length)
        const separator = options.separator ?? '\n\n'

        const extractedUnits = await tracer.startSpan(Spans.EXTRACT_RUNS, async (extractSpan) => {
          const parallel = options.parallel ?? true
          extractSpan.setAttribute(SemanticAttributes.RUN_COUNT, runs.length)
          extractSpan.setAttribute('extractingUnits', true)
          extractSpan.setAttribute('parallel', parallel && plugin.capabilities.parallel)
          return this.extractUnitsFromRuns(
            runs,
            doc,
            plugin,
            options,
            progress,
            errors,
            analyzedUnits.length,
          )
        })

        // Sort units by index to ensure correct order
        extractedUnits.sort((a, b) => a.index - b.index)

        const text = extractedUnits.map((u) => u.text).join(separator)
        progress.extractDone(text.length)

        this.recordExtractionMetrics(
          span,
          { logger, metrics },
          { source, format, analyzedUnits, runs, text, errors, startTime, label: 'with units' },
        )

        return {
          units: extractedUnits,
          result: {
            text,
            source,
            format,
            unitCount: analyzedUnits.length,
            runCount: runs.length,
            errors,
            metadata: options.includeMetadata ? metadata : undefined,
          },
        }
      } catch (err) {
        if (!isAbortError(err) && holder.format) {
          metrics
            .counter(Metrics.EXTRACTION_COUNT)
            .add(1, { status: 'error', format: holder.format })
          logger.error({ err, source, format: holder.format }, 'Extraction with units failed')
        }
        throw err
      } finally {
        if (holder.doc && holder.plugin) {
          await this.cleanupDoc(holder.doc, holder.plugin)
        }
      }
    })
  }

  /**
   * Extract text using vision (LLM).
   * Returns an async generator that yields chunks as they're processed.
   *
   * @param input - Document input
   * @param options - Vision extraction options
   * @yields Vision chunks (unit-start, content, unit-done, error)
   */
  async *extractWithVision<U extends DocumentUnit = DocumentUnit>(
    input: DocumentInput,
    options: VisionExtractOptions,
  ): AsyncGenerator<VisionChunk, void, unknown> {
    // Generate correlation ID for end-to-end request tracing
    const correlationId = generateCorrelationId()
    const { logger, tracer, metrics } = obsWithCorrelation('pipeline', correlationId)
    const source = describeSource(input)
    const startTime = performance.now()

    // We can't wrap a generator in startSpan, so we record metrics manually
    logger.info({ source, model: options.model, correlationId }, 'Starting vision extraction')

    // 0. Resolve HTTP(S) URL to bytes + mimeType (smart routing)
    let resolvedInput: DocumentInput = input
    let resolvedMimeType: string | undefined
    let resolvedSourceUrl: string | undefined
    const urlResolved = await this.resolveUrlInput(input, options, {
      tracer,
      metrics,
      logger,
    })
    if (urlResolved) {
      resolvedInput = urlResolved.bytes
      resolvedMimeType = urlResolved.mimeType
      resolvedSourceUrl = urlResolved.finalUrl
    }

    // 1. Detect format and get plugin
    const detected = this.registry.detectFormat(resolvedInput, {
      format: options.format,
      mimeType: resolvedMimeType,
    })
    if (!detected) {
      metrics.counter(Metrics.VISION_EXTRACTION_COUNT).add(1, { status: 'error', error: 'format' })
      logger.error({ source }, 'Cannot detect format for vision extraction')
      throw new LoadError(`Cannot detect format for ${source}. Specify format explicitly.`)
    }

    const { format, plugin } = detected

    // Check vision capability
    if (!plugin.capabilities.vision || !canRender(plugin)) {
      metrics
        .counter(Metrics.VISION_EXTRACTION_COUNT)
        .add(1, { status: 'error', error: 'capability' })
      logger.error({ source, format, plugin: plugin.id }, 'Plugin does not support vision')
      throw new ExtractError(`Plugin ${plugin.id} does not support vision extraction.`)
    }

    // Create vision model
    const { createVisionModel, analyzeImageStreaming } = await import('../images/vision.js')
    const { model, error: modelError } = createVisionModel(options.model)
    if (!model) {
      metrics.counter(Metrics.VISION_EXTRACTION_COUNT).add(1, { status: 'error', error: 'model' })
      logger.error(
        { source, modelSpec: options.model, modelError },
        'Failed to create vision model',
      )
      throw new ExtractError(modelError ?? 'Failed to create vision model')
    }

    let doc: LoadedDocument | null = null
    let totalChars = 0
    let unitCount = 0
    let errorCount = 0

    // Merge sourceUrl into options so plugins can preserve URL provenance
    const loadOptions = resolvedSourceUrl ? { ...options, sourceUrl: resolvedSourceUrl } : options

    try {
      // 2. Load and parse
      throwIfAborted(options.signal, 'load')
      doc = await tracer.startSpan(Spans.VISION_LOAD, async (loadSpan) => {
        loadSpan.setAttribute(SemanticAttributes.FORMAT, format)
        return plugin.load(resolvedInput, loadOptions as unknown as Record<string, unknown>)
      })
      const loadedDoc = doc

      throwIfAborted(options.signal, 'parse')
      const parsed = await tracer.startSpan(Spans.VISION_PARSE, async (parseSpan) => {
        parseSpan.setAttribute(SemanticAttributes.FORMAT, format)
        const result = (await plugin.parse(
          loadedDoc,
          options as unknown as Record<string, unknown>,
        )) as ParsedDocument<U>
        parseSpan.setAttribute(SemanticAttributes.UNIT_COUNT, result.units.length)
        return result
      })

      // Yield metadata (always, so callers get the detected format)
      yield { type: 'metadata', metadata: parsed.metadata ?? {}, format }

      if (parsed.units.length === 0) {
        logger.info({ source, format }, 'Document has no units for vision extraction')
        metrics.counter(Metrics.VISION_EXTRACTION_COUNT).add(1, { status: 'empty', format })
        return
      }

      unitCount = parsed.units.length
      logger.info({ source, format, unitCount }, 'Processing units with vision')

      // Track previous unit's LLM output for continuity across pages
      let previousPageOutput = ''

      // 3. Process each unit
      for (const unit of parsed.units) {
        // Check for cancellation before each unit
        throwIfAborted(options.signal, 'format')

        yield { type: 'unit-start', unitIndex: unit.index, label: unit.label }

        const unitStartTime = performance.now()
        try {
          // Extract text first (digital or OCR depending on page type)
          // This gives the LLM text alongside the visual layout
          let extractedText: string | undefined
          let extractionMethod: 'digital' | 'ocr' | 'vision' | 'hybrid' | undefined
          let extractionConfidence: number | undefined
          try {
            const extraction = await tracer.startSpan(Spans.VISION_EXTRACT, async (extractSpan) => {
              extractSpan.setAttribute(SemanticAttributes.UNIT_INDEX, unit.index)
              const result = await plugin.extractUnit(
                unit,
                loadedDoc,
                options as unknown as Record<string, unknown>,
              )
              extractSpan.setAttribute(SemanticAttributes.CHAR_COUNT, result.charCount)
              extractSpan.setAttribute(
                SemanticAttributes.METHOD,
                result.extraction?.method ?? 'unknown',
              )
              if (result.extraction?.confidence !== undefined) {
                extractSpan.setAttribute(
                  SemanticAttributes.CONFIDENCE,
                  result.extraction.confidence,
                )
              }
              return result
            })
            // Only include text if we got meaningful content
            if (extraction.text && extraction.charCount > 0) {
              extractedText = extraction.text
              extractionMethod = extraction.extraction?.method
              extractionConfidence = extraction.extraction?.confidence
              logger.debug(
                {
                  unitIndex: unit.index,
                  charCount: extraction.charCount,
                  method: extractionMethod,
                  confidence: extractionConfidence,
                },
                'Extracted text for vision',
              )
            }
          } catch (extractErr) {
            // Text extraction is optional - log and continue without it
            logger.debug(
              { err: extractErr, unitIndex: unit.index },
              'Text extraction failed, continuing with image only',
            )
          }

          // Render unit to image
          const rendered = await tracer.startSpan(Spans.VISION_RENDER, async (renderSpan) => {
            renderSpan.setAttribute(SemanticAttributes.UNIT_INDEX, unit.index)
            renderSpan.setAttribute(SemanticAttributes.SCALE, options.renderScale ?? 2)
            const result = await plugin.renderUnit?.(unit, loadedDoc, {
              scale: options.renderScale ?? 2,
              usePlaywright: options.usePlaywright,
              textForCjkDetection: extractedText,
            })
            if (result) {
              renderSpan.setAttribute(SemanticAttributes.WIDTH, result.width)
              renderSpan.setAttribute(SemanticAttributes.HEIGHT, result.height)
            }
            return result
          })

          if (!rendered) {
            throw new ExtractError(`Failed to render unit ${unit.index}`)
          }

          // Build unit-specific prompt based on extraction method and confidence
          const basePrompt = this.buildVisionPrompt(
            source,
            options.systemPrompt,
            options.promptPreset,
            extractionMethod,
            extractionConfidence,
            extractedText !== undefined,
          )
          const unitPrompt = `${basePrompt}\n\nProcessing: ${unit.label}`

          // Stream LLM response (with extracted text and previous page context)
          let charCount = 0
          const unitChunks: string[] = []
          const stream = analyzeImageStreaming({
            imageData: rendered.base64,
            mimeType: rendered.mimeType,
            prompt: unitPrompt,
            model,
            width: rendered.width,
            height: rendered.height,
            experiment: options.experiment,
            onJournal: options.onJournal,
            filePath: `${source}#${unit.label}`,
            extractedText,
            previousPageOutput: previousPageOutput || undefined,
          })

          for await (const chunk of stream) {
            charCount += chunk.length
            unitChunks.push(chunk)
            yield { type: 'content', content: chunk, unitIndex: unit.index }
          }

          // Store truncated output for the next unit's continuity context
          previousPageOutput = extractPreviousTail(unitChunks.join(''))

          totalChars += charCount
          const unitDurationMs = Math.round(performance.now() - unitStartTime)
          metrics.counter(Metrics.VISION_UNIT_COUNT).add(1, { format, status: 'success' })
          metrics.histogram(Metrics.VISION_UNIT_CHARS).record(charCount, { format })
          metrics.histogram(Metrics.VISION_UNIT_DURATION_MS).record(unitDurationMs, { format })

          logger.debug(
            { unitIndex: unit.index, charCount, durationMs: unitDurationMs },
            'Vision unit completed',
          )

          yield { type: 'unit-done', unitIndex: unit.index, charCount }
        } catch (err) {
          errorCount++
          const error: UnitError = {
            unitIndex: unit.index,
            phase: 'vision',
            message: err instanceof Error ? err.message : String(err),
            cause: err instanceof Error ? err : undefined,
          }
          metrics.counter(Metrics.VISION_UNIT_COUNT).add(1, { format, status: 'error' })
          logger.error({ err, unitIndex: unit.index }, 'Vision unit failed')
          yield { type: 'error', error }
        }
      }

      // Record overall metrics
      const durationMs = Math.round(performance.now() - startTime)
      metrics.counter(Metrics.VISION_EXTRACTION_COUNT).add(1, { status: 'success', format })
      metrics.histogram(Metrics.VISION_EXTRACTION_DURATION_MS).record(durationMs, { format })
      metrics.histogram(Metrics.VISION_EXTRACTION_CHARS).record(totalChars, { format })

      if (errorCount > 0) {
        metrics.counter(Metrics.VISION_ERROR_COUNT).add(errorCount, { format })
        logger.warn(
          { source, format, unitCount, errorCount, totalChars, durationMs },
          'Vision extraction completed with errors',
        )
      } else {
        logger.info(
          { source, format, unitCount, totalChars, durationMs },
          'Vision extraction completed',
        )
      }
    } catch (err) {
      // Record failure metrics (unless aborted)
      if (!isAbortError(err)) {
        metrics.counter(Metrics.VISION_EXTRACTION_COUNT).add(1, { status: 'error', format })
        logger.error({ err, source, format }, 'Vision extraction failed')
      }
      throw err
    } finally {
      if (doc) {
        await this.cleanupDoc(doc, plugin)
      }
    }
  }

  /**
   * Build a vision prompt by composing text reliability and document type dimensions.
   * Priority: customPrompt > promptPreset > auto-composed from dimensions
   *
   * Text reliability is determined from extraction method and OCR confidence.
   * Document type is determined from file extension.
   */
  private buildVisionPrompt(
    source: string,
    customPrompt?: string,
    promptPreset?: PromptPreset,
    extractionMethod?: 'digital' | 'ocr' | 'vision' | 'hybrid',
    extractionConfidence?: number,
    hasText?: boolean,
  ): string {
    // 1. Custom prompt takes precedence
    if (customPrompt) {
      return customPrompt
    }

    // 2. Use preset if explicitly specified (strip {text} placeholder)
    if (promptPreset) {
      const preset = PROMPTS[promptPreset]
      return this.stripTextPlaceholder(preset)
    }

    // 3. Auto-compose prompt from two dimensions
    const extension = getExtension(source)
    const textReliability: TextReliability = determineTextReliability(
      extractionMethod,
      extractionConfidence,
      hasText,
    )
    const documentType: DocumentType = determineDocumentType(extension)

    return buildPromptForExtraction({ mode: 'vision', textReliability, documentType })
  }

  /**
   * Strip the {text} placeholder and preceding labels from a prompt template.
   * Vision mode handles extracted text separately via the extractedText parameter.
   */
  private stripTextPlaceholder(prompt: string): string {
    // Remove patterns like "\n\nText:\n{text}", "\n\nExtracted text:\n{text}", "\n\n{text}"
    return prompt
      .replace(/\n+(?:Extracted )?[Tt]ext:\n*\{text\}\s*$/i, '')
      .replace(/\n*\{text\}\s*$/, '')
      .trim()
  }

  // ============================================================================
  // URL Resolution
  // ============================================================================

  /**
   * Resolve an HTTP(S) URL input by fetching the content and extracting Content-Type.
   * Returns bytes + mimeType for format detection, or null if input is not a URL.
   */
  private async resolveUrlInput(
    input: DocumentInput,
    options: ExtractAllOptions,
    obs: {
      tracer: ReturnType<typeof obsWithCorrelation>['tracer']
      metrics: ReturnType<typeof obsWithCorrelation>['metrics']
      logger: ReturnType<typeof obsWithCorrelation>['logger']
    },
  ): Promise<{ bytes: Uint8Array; mimeType?: string; finalUrl: string } | null> {
    if (!isHttpUrl(input)) return null

    const { tracer, metrics, logger } = obs
    const url = typeof input === 'string' ? input : input.toString()

    return tracer.startSpan(Spans.URL_RESOLVE, async (span) => {
      span.setAttribute('url.original', url)

      const rawTimeout =
        (options as Record<string, unknown>).fetchTimeout ??
        (options as Record<string, unknown>).timeout
      const timeoutMs =
        typeof rawTimeout === 'number' && Number.isFinite(rawTimeout)
          ? rawTimeout
          : DEFAULT_FETCH_TIMEOUT_MS

      // Use AbortSignal.any to combine user signal with timeout — no manual listener needed
      const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)]
      if (options.signal) signals.push(options.signal)
      const combinedSignal = AbortSignal.any(signals)

      try {
        const response = await fetch(url, {
          signal: combinedSignal,
          headers: {
            'User-Agent': 'letmesense/1.0',
            Accept: '*/*',
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type')
        const mimeType = contentType?.split(';')[0].trim()
        const finalUrl = response.url || url

        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)

        span.setAttribute(SemanticAttributes.BYTES, bytes.length)
        if (mimeType) span.setAttribute('mime.type', mimeType)
        span.setAttribute('url.final', finalUrl)

        metrics.counter(Metrics.URL_RESOLVE_COUNT).add(1, { status: 'success' })
        metrics.histogram(Metrics.URL_RESOLVE_BYTES).record(bytes.length)
        logger.debug({ url, finalUrl, mimeType, bytes: bytes.length }, 'URL resolved')

        return { bytes, mimeType, finalUrl }
      } catch (err) {
        metrics.counter(Metrics.URL_RESOLVE_COUNT).add(1, { status: 'error' })
        throw err
      }
    })
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Shared preparation pipeline: detect → load → parse → analyze → classify → complexity.
   * Returns empty analyzedUnits if document has no units (callers handle empty result).
   */
  private async prepareExtraction<U extends DocumentUnit>(
    input: DocumentInput,
    options: ExtractAllOptions,
    obs: {
      logger: ReturnType<typeof obsWithCorrelation>['logger']
      tracer: ReturnType<typeof obsWithCorrelation>['tracer']
      metrics: ReturnType<typeof obsWithCorrelation>['metrics']
    },
    progress: ProgressReporter,
    source: string,
    span: Span,
    errors: UnitError[],
    holder: CleanupHolder,
  ): Promise<PreparedExtraction<U>> {
    const { logger, tracer, metrics } = obs

    progress.loadStart(source)

    // 0. Resolve HTTP(S) URL to bytes + mimeType (smart routing)
    let resolvedInput: DocumentInput = input
    let resolvedMimeType: string | undefined
    let resolvedSourceUrl: string | undefined
    const urlResolved = await this.resolveUrlInput(input, options, obs)
    if (urlResolved) {
      resolvedInput = urlResolved.bytes
      resolvedMimeType = urlResolved.mimeType
      resolvedSourceUrl = urlResolved.finalUrl
    }

    // 1. Detect format and get plugin
    const detected = this.registry.detectFormat(resolvedInput, {
      format: options.format,
      mimeType: resolvedMimeType,
    })
    if (!detected) {
      metrics.counter(Metrics.EXTRACTION_COUNT).add(1, { status: 'error', error: 'format' })
      logger.error({ source }, 'Cannot detect format')
      throw new LoadError(`Cannot detect format for ${source}. Specify format explicitly.`)
    }

    const { format, plugin } = detected
    holder.format = format
    span.setAttribute(SemanticAttributes.FORMAT, format)
    span.setAttribute('plugin', plugin.id)
    logger.info({ source, format }, 'Starting extraction')

    // Merge sourceUrl into options so plugins can preserve URL provenance
    const loadOptions = resolvedSourceUrl ? { ...options, sourceUrl: resolvedSourceUrl } : options

    // 2. Load document
    throwIfAborted(options.signal, 'load')
    const doc = await tracer.startSpan(Spans.LOAD, async (loadSpan) => {
      loadSpan.setAttribute(SemanticAttributes.FORMAT, format)
      const loaded = await plugin.load(resolvedInput, loadOptions as Record<string, unknown>)
      loadSpan.setAttribute(SemanticAttributes.BYTES, loaded.bytes.length)
      return loaded
    })
    // Populate holder so cleanup runs even if later steps throw
    holder.doc = doc
    holder.plugin = plugin
    progress.loadDone(source, format, doc.bytes.length)
    span.setAttribute(SemanticAttributes.BYTES, doc.bytes.length)

    // 3. Parse into units
    throwIfAborted(options.signal, 'parse')
    progress.parseStart(format)
    const parsed = await tracer.startSpan(Spans.PARSE, async (parseSpan) => {
      parseSpan.setAttribute(SemanticAttributes.FORMAT, format)
      const result = (await plugin.parse(
        doc,
        options as Record<string, unknown>,
      )) as ParsedDocument<U>
      parseSpan.setAttribute(SemanticAttributes.UNIT_COUNT, result.units.length)
      return result
    })
    progress.parseDone(parsed.units.length)

    if (parsed.units.length === 0) {
      logger.info({ source, format }, 'Document has no units')
      metrics.counter(Metrics.EXTRACTION_COUNT).add(1, { status: 'empty', format })
      return {
        format,
        plugin: plugin as FormatPlugin<U>,
        doc,
        analyzedUnits: [] as U[],
        runs: [],
        metadata: parsed.metadata,
      }
    }

    // 4. Analyze units
    throwIfAborted(options.signal, 'analyze')
    progress.analyzeStart(parsed.units.length)
    const analyzedUnits = await tracer.startSpan(Spans.ANALYZE, async (analyzeSpan) => {
      analyzeSpan.setAttribute(SemanticAttributes.UNIT_COUNT, parsed.units.length)
      const units = await this.analyzeUnits(
        parsed.units,
        doc,
        plugin as FormatPlugin<U>,
        options,
        progress,
        errors,
      )
      analyzeSpan.setAttribute('analyzedCount', units.length)
      return units
    })
    progress.analyzeDone(analyzedUnits.length)

    // 5. Classify and group into runs
    throwIfAborted(options.signal, 'extract')
    const runs = await tracer.startSpan(Spans.CLASSIFY, async (classifySpan) => {
      for (const unit of analyzedUnits) {
        unit.kind = plugin.classifyUnit(unit)
      }
      const buildKey = plugin.buildRunKey?.bind(plugin) ?? defaultBuildRunKey
      const result = buildRuns(analyzedUnits, buildKey)
      classifySpan.setAttribute(SemanticAttributes.RUN_COUNT, result.length)
      return result
    })

    // Compute and record document complexity
    const complexity = computeComplexity(analyzedUnits)
    const complexityAttrs = getComplexitySpanAttributes(complexity, format)
    span.setAttributes(complexityAttrs)
    metrics.histogram(Metrics.DOCUMENT_COMPLEXITY_SCORE).record(complexity.score, { format })
    metrics.histogram(Metrics.DOCUMENT_PAGE_COUNT).record(complexity.pageCount, { format })
    logger.debug(
      { format, complexity: complexity.score, pageCount: complexity.pageCount },
      'Document complexity calculated',
    )

    // Record unit kind distribution
    const kindCounts: Record<string, number> = {}
    for (const unit of analyzedUnits) {
      kindCounts[unit.kind] = (kindCounts[unit.kind] ?? 0) + 1
    }
    for (const [kind, count] of Object.entries(kindCounts)) {
      metrics.counter(Metrics.UNIT_COUNT).add(count, { format, kind })
    }

    return {
      format,
      plugin: plugin as FormatPlugin<U>,
      doc,
      analyzedUnits,
      runs,
      metadata: parsed.metadata,
    }
  }

  /**
   * Record shared extraction metrics on the span and metrics instruments.
   */
  private recordExtractionMetrics(
    span: Span,
    obs: {
      logger: ReturnType<typeof obsWithCorrelation>['logger']
      metrics: ReturnType<typeof obsWithCorrelation>['metrics']
    },
    ctx: {
      source: string
      format: FormatId
      analyzedUnits: DocumentUnit[]
      runs: DocumentRun[]
      text: string
      errors: UnitError[]
      startTime: number
      label?: string
    },
  ): void {
    const { logger, metrics } = obs
    const { source, format, analyzedUnits, runs, text, errors, startTime, label } = ctx
    const durationMs = Math.round(performance.now() - startTime)

    span.setAttribute(SemanticAttributes.UNIT_COUNT, analyzedUnits.length)
    span.setAttribute(SemanticAttributes.RUN_COUNT, runs.length)
    span.setAttribute(SemanticAttributes.CHAR_COUNT, text.length)
    span.setAttribute(SemanticAttributes.ERROR_COUNT, errors.length)
    span.setAttribute(SemanticAttributes.DURATION_MS, durationMs)

    metrics.counter(Metrics.EXTRACTION_COUNT).add(1, { status: 'success', format })
    metrics.counter(Metrics.RUN_COUNT).add(runs.length, { format })
    metrics.histogram(Metrics.EXTRACTION_DURATION_MS).record(durationMs, { format })
    metrics.histogram(Metrics.EXTRACTION_CHARS).record(text.length, { format })

    const suffix = label ? ` ${label}` : ''
    if (errors.length > 0) {
      metrics.counter(Metrics.ERROR_COUNT).add(errors.length, { format })
      logger.warn(
        { source, format, errorCount: errors.length },
        `Extraction${suffix} completed with errors`,
      )
    } else {
      logger.info(
        { source, format, unitCount: analyzedUnits.length, runCount: runs.length, durationMs },
        `Extraction${suffix} completed`,
      )
    }
  }

  /**
   * Cleanup a loaded document.
   */
  private async cleanupDoc(doc: LoadedDocument, plugin: FormatPlugin): Promise<void> {
    if (plugin.cleanup) {
      try {
        await plugin.cleanup(doc)
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Analyze all units, collecting errors for failed units.
   */
  private async analyzeUnits<U extends DocumentUnit>(
    units: U[],
    doc: LoadedDocument,
    plugin: FormatPlugin<U>,
    options: ExtractAllOptions,
    progress: ProgressReporter,
    errors: UnitError[],
  ): Promise<U[]> {
    const parallel = (options.parallel ?? true) && plugin.capabilities.parallel && units.length > 1

    if (parallel) {
      // Check for cancellation before starting parallel work
      throwIfAborted(options.signal, 'analyze')

      const results = await Promise.allSettled(
        units.map((unit) => plugin.analyzeUnit(unit, doc, options as Record<string, unknown>)),
      )

      const analyzed: U[] = []
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === 'fulfilled') {
          analyzed.push(result.value)
        } else {
          // Re-throw AbortError — don't treat as recoverable
          if (isAbortError(result.reason)) {
            throw result.reason
          }

          const error: UnitError = {
            unitIndex: units[i].index,
            phase: 'analyze',
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
            cause: result.reason instanceof Error ? result.reason : undefined,
          }

          if (options.strict) {
            throw wrapError(result.reason, 'analyze', `Failed to analyze unit ${units[i].index}`)
          }

          errors.push(error)
          progress.error('analyze', error, units[i].index)

          // Mark unit as unknown and include it
          analyzed.push({
            ...units[i],
            kind: 'unknown',
            error,
          } as U)
        }

        progress.analyzeUnit(units[i].index, units.length)
      }

      return analyzed
    }

    // Sequential analysis
    const analyzed: U[] = []

    for (const unit of units) {
      // Check for cancellation before each unit
      throwIfAborted(options.signal, 'analyze')

      try {
        const result = await plugin.analyzeUnit(unit, doc, options as Record<string, unknown>)
        analyzed.push(result)
      } catch (err) {
        // Always re-throw AbortError
        if (isAbortError(err)) {
          throw err
        }

        const error: UnitError = {
          unitIndex: unit.index,
          phase: 'analyze',
          message: err instanceof Error ? err.message : String(err),
          cause: err instanceof Error ? err : undefined,
        }

        if (options.strict) {
          throw wrapError(err, 'analyze', `Failed to analyze unit ${unit.index}`)
        }

        errors.push(error)
        progress.error('analyze', error, unit.index)

        // Mark unit as unknown and include it
        analyzed.push({
          ...unit,
          kind: 'unknown',
          error,
        })
      }

      progress.analyzeUnit(unit.index, units.length)
    }

    return analyzed
  }

  /**
   * Extract text from all runs.
   * Supports parallel extraction when enabled.
   */
  private async extractRuns<U extends DocumentUnit>(
    runs: DocumentRun<U>[],
    doc: LoadedDocument,
    plugin: FormatPlugin<U>,
    options: ExtractAllOptions,
    progress: ProgressReporter,
    errors: UnitError[],
  ): Promise<string[]> {
    const texts: string[] = []
    const parallel = options.parallel ?? true

    if (parallel && plugin.capabilities.parallel && runs.length > 1) {
      // Check for cancellation before starting parallel work
      throwIfAborted(options.signal, 'extract')

      // Parallel extraction
      const results = await Promise.allSettled(
        runs.map((run, index) => this.extractRun(run, doc, plugin, options, progress, index)),
      )

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === 'fulfilled') {
          texts.push(result.value)
        } else {
          // Re-throw AbortError - don't treat it as a recoverable error
          if (isAbortError(result.reason)) {
            throw result.reason
          }

          // Collect error but continue
          const run = runs[i]
          for (const unitIndex of run.unitIndices) {
            const error: UnitError = {
              unitIndex,
              phase: 'extract',
              message:
                result.reason instanceof Error ? result.reason.message : String(result.reason),
              cause: result.reason instanceof Error ? result.reason : undefined,
            }
            errors.push(error)
            progress.error('extract', error, unitIndex)
          }
          texts.push('') // Empty text for failed run
        }
      }
    } else {
      // Sequential extraction
      for (let i = 0; i < runs.length; i++) {
        // Check for cancellation before each run
        throwIfAborted(options.signal, 'extract')

        const run = runs[i]
        try {
          const text = await this.extractRun(run, doc, plugin, options, progress, i)
          texts.push(text)
        } catch (err) {
          // Always re-throw AbortError
          if (isAbortError(err)) {
            throw err
          }

          if (options.strict) {
            throw err
          }

          // Collect error but continue
          for (const unitIndex of run.unitIndices) {
            const error: UnitError = {
              unitIndex,
              phase: 'extract',
              message: err instanceof Error ? err.message : String(err),
              cause: err instanceof Error ? err : undefined,
            }
            errors.push(error)
            progress.error('extract', error, unitIndex)
          }
          texts.push('') // Empty text for failed run
        }
      }
    }

    return texts
  }

  /**
   * Extract text from a single run.
   */
  private async extractRun<U extends DocumentUnit>(
    run: DocumentRun<U>,
    doc: LoadedDocument,
    plugin: FormatPlugin<U>,
    options: ExtractAllOptions,
    progress: ProgressReporter,
    runIndex: number,
  ): Promise<string> {
    progress.extractRunStart(runIndex, run.unitIndices.length)

    const texts: string[] = []
    const separator = options.separator ?? '\n\n'

    for (const unit of run.units ?? []) {
      // Check for cancellation before each unit extraction
      throwIfAborted(options.signal, 'extract')

      const result = await plugin.extractUnit(unit, doc, options as Record<string, unknown>)
      texts.push(result.text)
      progress.extractUnit(unit.index, run.unitIndices.length, result.charCount)
    }

    const runText = texts.join(separator)
    progress.extractRunDone(runIndex, runText.length)

    return runText
  }

  /**
   * Extract individual units from runs with their metadata.
   * Supports parallel extraction when enabled.
   */
  private async extractUnitsFromRuns<U extends DocumentUnit>(
    runs: DocumentRun<U>[],
    doc: LoadedDocument,
    plugin: FormatPlugin<U>,
    options: ExtractAllOptions,
    progress: ProgressReporter,
    errors: UnitError[],
    totalUnits: number,
  ): Promise<ExtractedUnit[]> {
    const parallel = options.parallel ?? true

    // Flatten all units from runs
    const allUnits: U[] = []
    for (const run of runs) {
      for (const unit of run.units ?? []) {
        allUnits.push(unit)
      }
    }

    if (parallel && plugin.capabilities.parallel && allUnits.length > 1) {
      // Check for cancellation before starting parallel work
      throwIfAborted(options.signal, 'extract')

      // Parallel extraction
      const results = await Promise.allSettled(
        allUnits.map(async (unit) => {
          const result = await plugin.extractUnit(unit, doc, options as Record<string, unknown>)
          return {
            index: unit.index,
            label: unit.label,
            text: result.text,
            kind: unit.kind,
            language: unit.language,
            charCount: result.charCount,
          }
        }),
      )

      const extractedUnits: ExtractedUnit[] = []
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const unit = allUnits[i]

        if (result.status === 'fulfilled') {
          extractedUnits.push({
            index: result.value.index,
            label: result.value.label,
            text: result.value.text,
            kind: result.value.kind,
            language: result.value.language,
          })
          progress.extractUnit(unit.index, totalUnits, result.value.charCount)
        } else {
          // Re-throw AbortError - don't treat it as a recoverable error
          if (isAbortError(result.reason)) {
            throw result.reason
          }

          if (options.strict) {
            throw result.reason
          }

          // Collect error but continue
          const error: UnitError = {
            unitIndex: unit.index,
            phase: 'extract',
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
            cause: result.reason instanceof Error ? result.reason : undefined,
          }
          errors.push(error)
          progress.error('extract', error, unit.index)

          // Add unit with empty text
          extractedUnits.push({
            index: unit.index,
            label: unit.label,
            text: '',
            kind: unit.kind,
            language: unit.language,
          })
        }
      }

      return extractedUnits
    }
    // Sequential extraction
    const extractedUnits: ExtractedUnit[] = []

    for (const unit of allUnits) {
      throwIfAborted(options.signal, 'extract')

      try {
        const result = await plugin.extractUnit(unit, doc, options as Record<string, unknown>)
        extractedUnits.push({
          index: unit.index,
          label: unit.label,
          text: result.text,
          kind: unit.kind,
          language: unit.language,
        })
        progress.extractUnit(unit.index, totalUnits, result.charCount)
      } catch (err) {
        if (isAbortError(err)) {
          throw err
        }

        if (options.strict) {
          throw err
        }

        // Collect error but continue
        const error: UnitError = {
          unitIndex: unit.index,
          phase: 'extract',
          message: err instanceof Error ? err.message : String(err),
          cause: err instanceof Error ? err : undefined,
        }
        errors.push(error)
        progress.error('extract', error, unit.index)

        // Add unit with empty text
        extractedUnits.push({
          index: unit.index,
          label: unit.label,
          text: '',
          kind: unit.kind,
          language: unit.language,
        })
      }
    }

    return extractedUnits
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Extract text from a document using the default registry.
 *
 * @param input - Document input
 * @param options - Extraction options
 * @returns Extraction result
 */
export async function extract(
  input: DocumentInput,
  options: ExtractAllOptions = {},
): Promise<ExtractionResult> {
  const processor = new PipelineProcessor()
  return processor.extract(input, options)
}

/**
 * Extract text using vision with the default registry.
 *
 * @param input - Document input
 * @param options - Vision extraction options
 * @yields Vision chunks
 */
export async function* extractWithVision(
  input: DocumentInput,
  options: VisionExtractOptions,
): AsyncGenerator<VisionChunk, void, unknown> {
  const processor = new PipelineProcessor()
  yield* processor.extractWithVision(input, options)
}

/**
 * Extract text from a document with individual units preserved.
 * Use this when per-unit processing is needed (e.g., LLM formatting).
 *
 * @param input - Document input
 * @param options - Extraction options
 * @returns Extraction result with individual unit texts
 */
export async function extractUnits(
  input: DocumentInput,
  options: ExtractAllOptions = {},
): Promise<ExtractUnitsResult> {
  const processor = new PipelineProcessor()
  return processor.extractUnits(input, options)
}

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * Check if a DocumentInput is an HTTP(S) URL.
 */
function isHttpUrl(input: DocumentInput): boolean {
  if (typeof input === 'string') {
    return input.startsWith('http://') || input.startsWith('https://')
  }
  if (input instanceof URL) {
    return input.protocol === 'http:' || input.protocol === 'https:'
  }
  return false
}
