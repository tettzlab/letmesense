/**
 * Pipeline processor for the unified extraction pipeline.
 * Orchestrates format plugins to extract text from documents.
 */

import { extractPreviousTail } from '../ai/format.js'
import { PROMPTS, type PromptPreset } from '../ai/prompts.js'
import { generateCorrelationId, obsWithCorrelation } from '../observability/index.js'
import { SemanticMetrics, SpanNames } from '../observability/types.js'
import { computeComplexity, getComplexitySpanAttributes } from './complexity.js'
import { AbortError, ExtractError, LoadError, throwIfAborted, wrapError } from './errors.js'
import type { FormatPlugin, LoadedDocument, ParsedDocument } from './plugin.js'
import { buildRuns, canRender, defaultBuildRunKey } from './plugin.js'
import { ProgressReporter } from './progress.js'
import {
  buildPromptForExtraction,
  type DocumentType,
  determineDocumentType,
  determineTextReliability,
  type TextReliability,
} from './prompts.js'
import {
  describeSource,
  getDefaultRegistry,
  getExtension,
  type PluginRegistry,
} from './registry.js'
import type {
  DocumentInput,
  DocumentRun,
  DocumentUnit,
  ExtractAllOptions,
  ExtractedUnit,
  ExtractionResult,
  ExtractUnitsResult,
  UnitError,
  VisionChunk,
  VisionExtractOptions,
} from './types.js'

// ============================================================================
// Pipeline Processor
// ============================================================================

// TODO: extract() and extractUnits() share ~90% of their code (load, parse, analyze,
// classify, record metrics). Consider refactoring to a shared prepareExtraction() method
// that returns the prepared context, with each public method handling only extraction.
// This would reduce ~200 lines of duplication.

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
    // Generate correlation ID for end-to-end request tracing
    const correlationId = generateCorrelationId()
    const { logger, tracer, metrics } = obsWithCorrelation('pipeline', correlationId)
    const progress = new ProgressReporter(options.onProgress)
    const source = describeSource(input)
    const errors: UnitError[] = []
    const startTime = performance.now()

    return tracer.startSpan(SpanNames.PIPELINE_EXTRACT, async (span) => {
      span.setAttribute('source', source)
      span.setAttribute('correlation.id', correlationId)

      progress.loadStart(source)

      // 1. Detect format and get plugin
      const detected = this.registry.detectFormat(input, { format: options.format })
      if (!detected) {
        metrics
          .counter(SemanticMetrics.PIPELINE_EXTRACTIONS_COUNT)
          .add(1, { status: 'error', error: 'format' })
        logger.error({ source }, 'Cannot detect format')
        throw new LoadError(`Cannot detect format for ${source}. Specify format explicitly.`)
      }

      const { format, plugin } = detected
      span.setAttribute('format', format)
      span.setAttribute('plugin', plugin.id)
      logger.info({ source, format }, 'Starting extraction')

      let doc: LoadedDocument | null = null

      try {
        // 2. Load document
        throwIfAborted(options.signal, 'load')
        doc = await tracer.startSpan(SpanNames.PIPELINE_LOAD, async (loadSpan) => {
          loadSpan.setAttribute('format', format)
          const loaded = await plugin.load(input, options as Record<string, unknown>)
          loadSpan.setAttribute('bytes', loaded.bytes.length)
          return loaded
        })
        const loadedDoc = doc
        progress.loadDone(source, format, loadedDoc.bytes.length)
        span.setAttribute('bytes', loadedDoc.bytes.length)

        // 3. Parse into units
        throwIfAborted(options.signal, 'parse')
        progress.parseStart(format)
        const parsed = await tracer.startSpan(SpanNames.PIPELINE_PARSE, async (parseSpan) => {
          parseSpan.setAttribute('format', format)
          const result = (await plugin.parse(
            loadedDoc,
            options as Record<string, unknown>,
          )) as ParsedDocument<U>
          parseSpan.setAttribute('unitCount', result.units.length)
          return result
        })
        progress.parseDone(parsed.units.length)

        if (parsed.units.length === 0) {
          logger.info({ source, format }, 'Document has no units')
          metrics
            .counter(SemanticMetrics.PIPELINE_EXTRACTIONS_COUNT)
            .add(1, { status: 'empty', format })
          return {
            text: '',
            source,
            format,
            unitCount: 0,
            runCount: 0,
            errors: [],
            metadata: options.includeMetadata ? parsed.metadata : undefined,
          }
        }

        // 4. Analyze units
        throwIfAborted(options.signal, 'analyze')
        progress.analyzeStart(parsed.units.length)
        const analyzedUnits = await tracer.startSpan(
          SpanNames.PIPELINE_ANALYZE,
          async (analyzeSpan) => {
            analyzeSpan.setAttribute('unitCount', parsed.units.length)
            const units = await this.analyzeUnits(
              parsed.units,
              loadedDoc,
              plugin as FormatPlugin<U>,
              options,
              progress,
              errors,
            )
            analyzeSpan.setAttribute('analyzedCount', units.length)
            return units
          },
        )
        progress.analyzeDone(analyzedUnits.length)

        // 5. Classify and group into runs
        throwIfAborted(options.signal, 'extract')
        const runs = await tracer.startSpan(SpanNames.PIPELINE_CLASSIFY, async (classifySpan) => {
          for (const unit of analyzedUnits) {
            unit.kind = plugin.classifyUnit(unit)
          }
          const buildKey = plugin.buildRunKey?.bind(plugin) ?? defaultBuildRunKey
          const result = buildRuns(analyzedUnits, buildKey)
          classifySpan.setAttribute('runCount', result.length)
          return result
        })

        // Compute and record document complexity
        const complexity = computeComplexity(analyzedUnits)
        const complexityAttrs = getComplexitySpanAttributes(complexity, format)
        span.setAttributes(complexityAttrs)
        metrics
          .histogram(SemanticMetrics.DOCUMENT_COMPLEXITY_SCORE)
          .record(complexity.score, { format })
        metrics
          .histogram(SemanticMetrics.DOCUMENT_PAGE_COUNT)
          .record(complexity.pageCount, { format })
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
          metrics.counter(SemanticMetrics.PIPELINE_UNITS_COUNT).add(count, { format, kind })
        }

        // 6. Extract text from runs
        progress.extractStart(runs.length)
        const separator = options.separator ?? '\n\n'
        const texts = await tracer.startSpan(
          SpanNames.PIPELINE_EXTRACT_RUNS,
          async (extractSpan) => {
            extractSpan.setAttribute('runCount', runs.length)
            extractSpan.setAttribute('parallel', options.parallel ?? true)
            return this.extractRuns(
              runs,
              loadedDoc,
              plugin as FormatPlugin<U>,
              options,
              progress,
              errors,
            )
          },
        )
        progress.extractDone(texts.join(separator).length)

        // 7. Build result
        const text = texts.join(separator)
        const durationMs = Math.round(performance.now() - startTime)

        span.setAttribute('unitCount', analyzedUnits.length)
        span.setAttribute('runCount', runs.length)
        span.setAttribute('charCount', text.length)
        span.setAttribute('errorCount', errors.length)
        span.setAttribute('durationMs', durationMs)

        // Record metrics
        metrics
          .counter(SemanticMetrics.PIPELINE_EXTRACTIONS_COUNT)
          .add(1, { status: 'success', format })
        metrics.counter(SemanticMetrics.PIPELINE_RUNS_COUNT).add(runs.length, { format })
        metrics
          .histogram(SemanticMetrics.PIPELINE_EXTRACTION_DURATION_MS)
          .record(durationMs, { format })
        metrics.histogram(SemanticMetrics.PIPELINE_EXTRACTION_CHARS).record(text.length, { format })

        if (errors.length > 0) {
          metrics.counter(SemanticMetrics.PIPELINE_ERRORS_COUNT).add(errors.length, { format })
          logger.warn(
            { source, format, errorCount: errors.length },
            'Extraction completed with errors',
          )
        } else {
          logger.info(
            { source, format, unitCount: analyzedUnits.length, runCount: runs.length, durationMs },
            'Extraction completed',
          )
        }

        return {
          text,
          source,
          format,
          unitCount: analyzedUnits.length,
          runCount: runs.length,
          errors,
          metadata: options.includeMetadata ? parsed.metadata : undefined,
        }
      } catch (err) {
        // Record failure metrics (unless aborted)
        if (!(err instanceof AbortError)) {
          metrics
            .counter(SemanticMetrics.PIPELINE_EXTRACTIONS_COUNT)
            .add(1, { status: 'error', format })
          logger.error({ err, source, format }, 'Extraction failed')
        }
        throw err
      } finally {
        // 8. Cleanup
        if (doc && plugin.cleanup) {
          try {
            await plugin.cleanup(doc)
          } catch {
            // Ignore cleanup errors
          }
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
    // Generate correlation ID for end-to-end request tracing
    const correlationId = generateCorrelationId()
    const { logger, tracer, metrics } = obsWithCorrelation('pipeline', correlationId)
    const progress = new ProgressReporter(options.onProgress)
    const source = describeSource(input)
    const errors: UnitError[] = []
    const startTime = performance.now()

    return tracer.startSpan(SpanNames.PIPELINE_EXTRACT, async (span) => {
      span.setAttribute('source', source)
      span.setAttribute('correlation.id', correlationId)
      span.setAttribute('extractUnits', true)

      progress.loadStart(source)

      // 1. Detect format and get plugin
      const detected = this.registry.detectFormat(input, { format: options.format })
      if (!detected) {
        metrics
          .counter(SemanticMetrics.PIPELINE_EXTRACTIONS_COUNT)
          .add(1, { status: 'error', error: 'format' })
        logger.error({ source }, 'Cannot detect format')
        throw new LoadError(`Cannot detect format for ${source}. Specify format explicitly.`)
      }

      const { format, plugin } = detected
      span.setAttribute('format', format)
      span.setAttribute('plugin', plugin.id)
      logger.info({ source, format }, 'Starting extraction with units')

      let doc: LoadedDocument | null = null

      try {
        // 2. Load document
        throwIfAborted(options.signal, 'load')
        doc = await tracer.startSpan(SpanNames.PIPELINE_LOAD, async (loadSpan) => {
          loadSpan.setAttribute('format', format)
          const loaded = await plugin.load(input, options as Record<string, unknown>)
          loadSpan.setAttribute('bytes', loaded.bytes.length)
          return loaded
        })
        const loadedDoc = doc
        progress.loadDone(source, format, loadedDoc.bytes.length)
        span.setAttribute('bytes', loadedDoc.bytes.length)

        // 3. Parse into units
        throwIfAborted(options.signal, 'parse')
        progress.parseStart(format)
        const parsed = await tracer.startSpan(SpanNames.PIPELINE_PARSE, async (parseSpan) => {
          parseSpan.setAttribute('format', format)
          const result = (await plugin.parse(
            loadedDoc,
            options as Record<string, unknown>,
          )) as ParsedDocument<U>
          parseSpan.setAttribute('unitCount', result.units.length)
          return result
        })
        progress.parseDone(parsed.units.length)

        if (parsed.units.length === 0) {
          logger.info({ source, format }, 'Document has no units')
          metrics
            .counter(SemanticMetrics.PIPELINE_EXTRACTIONS_COUNT)
            .add(1, { status: 'empty', format })
          return {
            units: [],
            result: {
              text: '',
              source,
              format,
              unitCount: 0,
              runCount: 0,
              errors: [],
              metadata: options.includeMetadata ? parsed.metadata : undefined,
            },
          }
        }

        // 4. Analyze units
        throwIfAborted(options.signal, 'analyze')
        progress.analyzeStart(parsed.units.length)
        const analyzedUnits = await tracer.startSpan(
          SpanNames.PIPELINE_ANALYZE,
          async (analyzeSpan) => {
            analyzeSpan.setAttribute('unitCount', parsed.units.length)
            const units = await this.analyzeUnits(
              parsed.units,
              loadedDoc,
              plugin as FormatPlugin<U>,
              options,
              progress,
              errors,
            )
            analyzeSpan.setAttribute('analyzedCount', units.length)
            return units
          },
        )
        progress.analyzeDone(analyzedUnits.length)

        // 5. Classify and group into runs
        throwIfAborted(options.signal, 'extract')
        const runs = await tracer.startSpan(SpanNames.PIPELINE_CLASSIFY, async (classifySpan) => {
          for (const unit of analyzedUnits) {
            unit.kind = plugin.classifyUnit(unit)
          }
          const buildKey = plugin.buildRunKey?.bind(plugin) ?? defaultBuildRunKey
          const result = buildRuns(analyzedUnits, buildKey)
          classifySpan.setAttribute('runCount', result.length)
          return result
        })

        // Compute and record document complexity
        const complexity = computeComplexity(analyzedUnits)
        const complexityAttrs = getComplexitySpanAttributes(complexity, format)
        span.setAttributes(complexityAttrs)
        metrics
          .histogram(SemanticMetrics.DOCUMENT_COMPLEXITY_SCORE)
          .record(complexity.score, { format })
        metrics
          .histogram(SemanticMetrics.DOCUMENT_PAGE_COUNT)
          .record(complexity.pageCount, { format })
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
          metrics.counter(SemanticMetrics.PIPELINE_UNITS_COUNT).add(count, { format, kind })
        }

        // 6. Extract text from each unit individually
        progress.extractStart(runs.length)
        const separator = options.separator ?? '\n\n'
        const parallel = options.parallel ?? true

        const extractedUnits = await tracer.startSpan(
          SpanNames.PIPELINE_EXTRACT_RUNS,
          async (extractSpan) => {
            extractSpan.setAttribute('runCount', runs.length)
            extractSpan.setAttribute('extractingUnits', true)
            extractSpan.setAttribute('parallel', parallel && plugin.capabilities.parallel)

            return this.extractUnitsFromRuns(
              runs,
              loadedDoc,
              plugin as FormatPlugin<U>,
              options,
              progress,
              errors,
              analyzedUnits.length,
            )
          },
        )

        // Sort units by index to ensure correct order
        extractedUnits.sort((a, b) => a.index - b.index)

        // 7. Build concatenated text for the result
        const text = extractedUnits.map((u) => u.text).join(separator)
        progress.extractDone(text.length)

        const durationMs = Math.round(performance.now() - startTime)

        span.setAttribute('unitCount', analyzedUnits.length)
        span.setAttribute('runCount', runs.length)
        span.setAttribute('charCount', text.length)
        span.setAttribute('errorCount', errors.length)
        span.setAttribute('durationMs', durationMs)

        // Record metrics
        metrics
          .counter(SemanticMetrics.PIPELINE_EXTRACTIONS_COUNT)
          .add(1, { status: 'success', format })
        metrics.counter(SemanticMetrics.PIPELINE_RUNS_COUNT).add(runs.length, { format })
        metrics
          .histogram(SemanticMetrics.PIPELINE_EXTRACTION_DURATION_MS)
          .record(durationMs, { format })
        metrics.histogram(SemanticMetrics.PIPELINE_EXTRACTION_CHARS).record(text.length, { format })

        if (errors.length > 0) {
          metrics.counter(SemanticMetrics.PIPELINE_ERRORS_COUNT).add(errors.length, { format })
          logger.warn(
            { source, format, errorCount: errors.length },
            'Extraction with units completed with errors',
          )
        } else {
          logger.info(
            { source, format, unitCount: analyzedUnits.length, runCount: runs.length, durationMs },
            'Extraction with units completed',
          )
        }

        return {
          units: extractedUnits,
          result: {
            text,
            source,
            format,
            unitCount: analyzedUnits.length,
            runCount: runs.length,
            errors,
            metadata: options.includeMetadata ? parsed.metadata : undefined,
          },
        }
      } catch (err) {
        // Record failure metrics (unless aborted)
        if (!(err instanceof AbortError)) {
          metrics
            .counter(SemanticMetrics.PIPELINE_EXTRACTIONS_COUNT)
            .add(1, { status: 'error', format })
          logger.error({ err, source, format }, 'Extraction with units failed')
        }
        throw err
      } finally {
        // 8. Cleanup
        if (doc && plugin.cleanup) {
          try {
            await plugin.cleanup(doc)
          } catch {
            // Ignore cleanup errors
          }
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

    // 1. Detect format and get plugin
    const detected = this.registry.detectFormat(input, { format: options.format })
    if (!detected) {
      metrics
        .counter(SemanticMetrics.PIPELINE_VISION_EXTRACTIONS_COUNT)
        .add(1, { status: 'error', error: 'format' })
      logger.error({ source }, 'Cannot detect format for vision extraction')
      throw new LoadError(`Cannot detect format for ${source}. Specify format explicitly.`)
    }

    const { format, plugin } = detected

    // Check vision capability
    if (!plugin.capabilities.vision || !canRender(plugin)) {
      metrics
        .counter(SemanticMetrics.PIPELINE_VISION_EXTRACTIONS_COUNT)
        .add(1, { status: 'error', error: 'capability' })
      logger.error({ source, format, plugin: plugin.id }, 'Plugin does not support vision')
      throw new ExtractError(`Plugin ${plugin.id} does not support vision extraction.`)
    }

    // Create vision model
    const { createVisionModel, analyzeImageStreaming } = await import('../images/vision.js')
    const { model, error: modelError } = createVisionModel(options.model)
    if (!model) {
      metrics
        .counter(SemanticMetrics.PIPELINE_VISION_EXTRACTIONS_COUNT)
        .add(1, { status: 'error', error: 'model' })
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

    try {
      // 2. Load and parse
      throwIfAborted(options.signal, 'load')
      doc = await tracer.startSpan(SpanNames.PIPELINE_VISION_LOAD, async (loadSpan) => {
        loadSpan.setAttribute('format', format)
        return plugin.load(input, options as unknown as Record<string, unknown>)
      })
      const loadedDoc = doc

      throwIfAborted(options.signal, 'parse')
      const parsed = await tracer.startSpan(SpanNames.PIPELINE_VISION_PARSE, async (parseSpan) => {
        parseSpan.setAttribute('format', format)
        const result = (await plugin.parse(
          loadedDoc,
          options as unknown as Record<string, unknown>,
        )) as ParsedDocument<U>
        parseSpan.setAttribute('unitCount', result.units.length)
        return result
      })

      if (parsed.units.length === 0) {
        logger.info({ source, format }, 'Document has no units for vision extraction')
        metrics
          .counter(SemanticMetrics.PIPELINE_VISION_EXTRACTIONS_COUNT)
          .add(1, { status: 'empty', format })
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
            const extraction = await tracer.startSpan(
              SpanNames.PIPELINE_VISION_EXTRACT,
              async (extractSpan) => {
                extractSpan.setAttribute('unitIndex', unit.index)
                const result = await plugin.extractUnit(
                  unit,
                  loadedDoc,
                  options as unknown as Record<string, unknown>,
                )
                extractSpan.setAttribute('charCount', result.charCount)
                extractSpan.setAttribute('method', result.extraction?.method ?? 'unknown')
                if (result.extraction?.confidence !== undefined) {
                  extractSpan.setAttribute('confidence', result.extraction.confidence)
                }
                return result
              },
            )
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
          const rendered = await tracer.startSpan(
            SpanNames.PIPELINE_VISION_RENDER,
            async (renderSpan) => {
              renderSpan.setAttribute('unitIndex', unit.index)
              renderSpan.setAttribute('scale', options.renderScale ?? 2)
              const result = await plugin.renderUnit?.(unit, loadedDoc, {
                scale: options.renderScale ?? 2,
                usePlaywright: options.usePlaywright,
                textForCjkDetection: extractedText,
              })
              if (result) {
                renderSpan.setAttribute('width', result.width)
                renderSpan.setAttribute('height', result.height)
              }
              return result
            },
          )

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
          metrics
            .counter(SemanticMetrics.PIPELINE_VISION_UNITS_COUNT)
            .add(1, { format, status: 'success' })
          metrics
            .histogram(SemanticMetrics.PIPELINE_VISION_UNIT_CHARS)
            .record(charCount, { format })
          metrics
            .histogram(SemanticMetrics.PIPELINE_VISION_UNIT_DURATION_MS)
            .record(unitDurationMs, { format })

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
          metrics
            .counter(SemanticMetrics.PIPELINE_VISION_UNITS_COUNT)
            .add(1, { format, status: 'error' })
          logger.error({ err, unitIndex: unit.index }, 'Vision unit failed')
          yield { type: 'error', error }
        }
      }

      // Record overall metrics
      const durationMs = Math.round(performance.now() - startTime)
      metrics
        .counter(SemanticMetrics.PIPELINE_VISION_EXTRACTIONS_COUNT)
        .add(1, { status: 'success', format })
      metrics
        .histogram(SemanticMetrics.PIPELINE_VISION_EXTRACTION_DURATION_MS)
        .record(durationMs, { format })
      metrics
        .histogram(SemanticMetrics.PIPELINE_VISION_EXTRACTION_CHARS)
        .record(totalChars, { format })

      if (errorCount > 0) {
        metrics.counter(SemanticMetrics.PIPELINE_VISION_ERRORS_COUNT).add(errorCount, { format })
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
      if (!(err instanceof AbortError)) {
        metrics
          .counter(SemanticMetrics.PIPELINE_VISION_EXTRACTIONS_COUNT)
          .add(1, { status: 'error', format })
        logger.error({ err, source, format }, 'Vision extraction failed')
      }
      throw err
    } finally {
      if (doc && plugin.cleanup) {
        try {
          await plugin.cleanup(doc)
        } catch {
          // Ignore cleanup errors
        }
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
  // Private Helpers
  // ============================================================================

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
    const analyzed: U[] = []

    for (const unit of units) {
      // Check for cancellation before each unit
      throwIfAborted(options.signal, 'analyze')

      try {
        const result = await plugin.analyzeUnit(unit, doc, options as Record<string, unknown>)
        analyzed.push(result)
      } catch (err) {
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
          if (result.reason instanceof AbortError) {
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
          if (err instanceof AbortError) {
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
          if (result.reason instanceof AbortError) {
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
    } else {
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
          if (err instanceof AbortError) {
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
