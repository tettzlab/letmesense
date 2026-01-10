/**
 * Main orchestration for LLM-powered markdown formatting
 */

import { obs, SemanticMetrics } from '../observability/index.js'
import { SpanNames } from '../observability/types.js'
import { estimateCost } from './cost.js'
import { calculateEntryCost, createJournalEntry } from './journal.js'
import { DEFAULT_TEXT_PROMPT, DEFAULT_VISION_PROMPT, substituteVariables } from './prompts.js'
import { buildConfig, getProvider, resolveProvider } from './provider.js'
import { buildProviderOptions } from './providerOptions.js'
import { resolveModel as resolveModelFull } from './resolve.js'
import type {
  CostBreakdown,
  CostEstimate,
  FormatRequest,
  LlmConfig,
  LlmFormatOptions,
  PageContext,
  StreamEvent,
} from './types.js'

/** Default page separator in formatted output */
export const DEFAULT_MARKDOWN_PAGE_SEPARATOR = '\n\n---\n\n'

/** Maximum characters to use for previousTail context */
const PREVIOUS_TAIL_MAX_LENGTH = 200

/**
 * Extract a clean tail from content for continuity context.
 * Finds a natural break point (sentence/paragraph end, word boundary)
 * to avoid cutting in the middle of words or markdown structures.
 */
export function extractPreviousTail(content: string, maxLength = PREVIOUS_TAIL_MAX_LENGTH): string {
  if (content.length <= maxLength) {
    return content
  }

  // Start from the last maxLength characters
  let tail = content.slice(-maxLength)

  // Try to find a natural break point (paragraph, sentence, or word boundary)
  // Priority: paragraph > sentence > word

  // Look for paragraph break (double newline)
  const paragraphBreak = tail.indexOf('\n\n')
  if (paragraphBreak !== -1 && paragraphBreak < maxLength * 0.5) {
    // Found a paragraph break in the first half, use content after it
    tail = tail.slice(paragraphBreak + 2)
  } else {
    // Look for sentence break (. ! ? followed by space or newline)
    const sentenceMatch = tail.match(/[.!?][\s\n]/)
    if (sentenceMatch?.index !== undefined && sentenceMatch.index < maxLength * 0.3) {
      // Found sentence end in the first third, use content after it
      tail = tail.slice(sentenceMatch.index + 2)
    } else {
      // Fall back to word boundary (space after first 10 chars to ensure some content)
      const spaceIndex = tail.indexOf(' ', 10)
      if (spaceIndex !== -1 && spaceIndex < maxLength * 0.2) {
        tail = tail.slice(spaceIndex + 1)
      }
    }
  }

  return tail.trim()
}

/** Result of formatting a single page */
export interface PageFormatResult {
  pageIndex: number
  content: string
  inputTokens: number
  outputTokens: number
  cost: CostBreakdown
}

/** Result of formatting a document */
export interface DocumentFormatResult {
  /** Formatted markdown content */
  content: string
  /** Per-page results */
  pages: PageFormatResult[]
  /** Total token usage */
  totalUsage: {
    inputTokens: number
    outputTokens: number
  }
  /** Aggregated cost breakdown */
  cost: CostBreakdown
}

/** Input for formatting a page */
export interface PageInput {
  /** Extracted text content */
  text: string
  /** Page image as base64 data URI (for vision mode) */
  image?: string
  /** Image dimensions (for cost estimation) */
  imageWidth?: number
  imageHeight?: number
  /** Page index (0-based) */
  pageIndex: number
  /** Detected language */
  language?: string
  /** Page kind classification */
  pageKind?: string
}

/**
 * Estimate the cost of formatting pages
 */
export function estimateFormatCost(pages: PageInput[], options: LlmFormatOptions): CostEstimate {
  const provider = resolveProvider(options.llm)
  const config = buildConfig(provider, options.llm, options.vision)

  return estimateCost(
    pages.map((p) => ({
      text: p.text,
      imageWidth: p.imageWidth,
      imageHeight: p.imageHeight,
    })),
    config,
    options.vision ?? false,
  )
}

/**
 * Format a single page as markdown
 */
export async function formatPage(
  page: PageInput,
  totalPages: number,
  previousTail: string,
  options: LlmFormatOptions,
  config: LlmConfig,
): Promise<PageFormatResult> {
  const { tracer, metrics } = obs('ai')
  const provider = getProvider(config.provider)
  if (!provider) throw new Error(`Provider '${config.provider}' not registered`)
  const model = config.model ?? provider.defaultModel

  return tracer.startSpan(SpanNames.AI_FORMAT_PAGE, async (span) => {
    span.setAttribute('pageIndex', page.pageIndex)
    span.setAttribute('provider', provider.name)
    span.setAttribute('model', model)

    const context: PageContext = {
      text: page.text,
      page: page.pageIndex + 1, // 1-indexed for display
      totalPages,
      language: page.language ?? 'und',
      pageKind: page.pageKind ?? 'unknown',
      previousTail,
      runIndex: 0,
    }

    const promptTemplate =
      options.promptTemplate ?? (options.vision ? DEFAULT_VISION_PROMPT : DEFAULT_TEXT_PROMPT)

    const request: FormatRequest = {
      text: page.text,
      image: options.vision ? page.image : undefined,
      context,
      promptTemplate,
      promptVariables: options.promptVariables,
    }

    // Measure timing for journaling
    const startTime = performance.now()
    const response = await provider.format(request, config)
    const durationMs = Math.round(performance.now() - startTime)

    // Record metrics
    metrics
      .counter(SemanticMetrics.AI_REQUEST_COUNT)
      .add(1, { provider: provider.name, model, status: 'success' })
    metrics.histogram(SemanticMetrics.AI_TOKEN_INPUT_COUNT).record(response.usage.inputTokens)
    metrics.histogram(SemanticMetrics.AI_TOKEN_OUTPUT_COUNT).record(response.usage.outputTokens)
    metrics.histogram(SemanticMetrics.AI_REQUEST_DURATION_MS).record(durationMs)

    // Calculate and record cost
    const pricing = provider.getPricing(model)
    const cost = calculateEntryCost(response.usage, pricing)
    metrics.histogram(SemanticMetrics.AI_COST_USD).record(cost.total)

    span.setAttribute('inputTokens', response.usage.inputTokens)
    span.setAttribute('outputTokens', response.usage.outputTokens)

    // Journal the LLM call if experiment is enabled
    if (options.experiment && options.onJournal) {
      const substitutedPrompt = substituteVariables(
        promptTemplate,
        context,
        options.promptVariables,
      )

      const entry = createJournalEntry({
        experiment: options.experiment,
        provider: provider.name,
        model,
        promptTemplate,
        prompt: substitutedPrompt,
        context,
        hasImage: !!request.image,
        hasPdf: !!request.pdf,
        output: response.content,
        tokens: response.usage,
        cost,
        durationMs,
        finishReason: response.finishReason,
        rawMeta: response.rawMeta,
        imageData: request.image,
        imageMimeType: request.image ? 'image/png' : undefined,
      })

      await options.onJournal(entry)
    }

    return {
      pageIndex: page.pageIndex,
      content: response.content,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cost,
    }
  })
}

/**
 * Format a single page with streaming
 */
export async function formatPageStream(
  page: PageInput,
  totalPages: number,
  previousTail: string,
  options: LlmFormatOptions,
  config: LlmConfig,
  onChunk: (chunk: string) => void,
): Promise<PageFormatResult> {
  const { tracer, metrics } = obs('ai')
  const provider = getProvider(config.provider)
  if (!provider) throw new Error(`Provider '${config.provider}' not registered`)
  const model = config.model ?? provider.defaultModel

  return tracer.startSpan(SpanNames.AI_FORMAT_PAGE, async (span) => {
    span.setAttribute('pageIndex', page.pageIndex)
    span.setAttribute('provider', provider.name)
    span.setAttribute('model', model)
    span.setAttribute('streaming', true)

    const context: PageContext = {
      text: page.text,
      page: page.pageIndex + 1,
      totalPages,
      language: page.language ?? 'und',
      pageKind: page.pageKind ?? 'unknown',
      previousTail,
      runIndex: 0,
    }

    const promptTemplate =
      options.promptTemplate ?? (options.vision ? DEFAULT_VISION_PROMPT : DEFAULT_TEXT_PROMPT)

    const request: FormatRequest = {
      text: page.text,
      image: options.vision ? page.image : undefined,
      context,
      promptTemplate,
      promptVariables: options.promptVariables,
    }

    // Measure timing for journaling
    const startTime = performance.now()
    const response = await provider.formatStream(request, config, onChunk)
    const durationMs = Math.round(performance.now() - startTime)

    // Record metrics
    metrics
      .counter(SemanticMetrics.AI_REQUEST_COUNT)
      .add(1, { provider: provider.name, model, status: 'success' })
    metrics.histogram(SemanticMetrics.AI_TOKEN_INPUT_COUNT).record(response.usage.inputTokens)
    metrics.histogram(SemanticMetrics.AI_TOKEN_OUTPUT_COUNT).record(response.usage.outputTokens)
    metrics.histogram(SemanticMetrics.AI_REQUEST_DURATION_MS).record(durationMs)

    // Calculate and record cost
    const pricing = provider.getPricing(model)
    const cost = calculateEntryCost(response.usage, pricing)
    metrics.histogram(SemanticMetrics.AI_COST_USD).record(cost.total)

    span.setAttribute('inputTokens', response.usage.inputTokens)
    span.setAttribute('outputTokens', response.usage.outputTokens)

    // Journal the LLM call if experiment is enabled
    if (options.experiment && options.onJournal) {
      const substitutedPrompt = substituteVariables(
        promptTemplate,
        context,
        options.promptVariables,
      )

      const entry = createJournalEntry({
        experiment: options.experiment,
        provider: provider.name,
        model,
        promptTemplate,
        prompt: substitutedPrompt,
        context,
        hasImage: !!request.image,
        hasPdf: !!request.pdf,
        output: response.content,
        tokens: response.usage,
        cost,
        durationMs,
        finishReason: response.finishReason,
        rawMeta: response.rawMeta,
        imageData: request.image,
        imageMimeType: request.image ? 'image/png' : undefined,
      })

      await options.onJournal(entry)
    }

    return {
      pageIndex: page.pageIndex,
      content: response.content,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cost,
    }
  })
}

/**
 * Format multiple pages as markdown
 */
export async function formatPages(
  pages: PageInput[],
  options: LlmFormatOptions,
): Promise<DocumentFormatResult> {
  const provider = resolveProvider(options.llm)
  const config = buildConfig(provider, options.llm, options.vision)

  // Inject providerOptions if model has reasoning effort and none were set
  if (!config.providerOptions && config.model) {
    try {
      const resolved = resolveModelFull(`${config.provider}:${config.model}`)
      if (resolved.effort) {
        config.providerOptions = buildProviderOptions(resolved)
      }
    } catch {
      // Unknown model — skip providerOptions injection
    }
  }

  const onProgress = options.onProgress

  const results: PageFormatResult[] = []
  let previousTail = ''
  const totalPages = pages.length

  // Emit start event
  if (onProgress) {
    const estimate = estimateFormatCost(pages, options)
    const event: StreamEvent = {
      type: 'start',
      totalPages,
      estimatedCost: estimate,
    }
    onProgress(event)
  }

  for (const page of pages) {
    // Emit page-start event
    if (onProgress) {
      const event: StreamEvent = { type: 'page-start', pageIndex: page.pageIndex }
      onProgress(event)
    }

    try {
      let result: PageFormatResult

      if (onProgress) {
        // Stream mode - emit content chunks
        result = await formatPageStream(
          page,
          totalPages,
          previousTail,
          options,
          config,
          (chunk) => {
            const event: StreamEvent = {
              type: 'content',
              content: chunk,
              pageIndex: page.pageIndex,
            }
            onProgress(event)
          },
        )
      } else {
        // Non-streaming mode
        result = await formatPage(page, totalPages, previousTail, options, config)
      }

      results.push(result)

      // Update previousTail for continuity (find natural break point)
      previousTail = extractPreviousTail(result.content)

      // Emit page-done event
      if (onProgress) {
        const event: StreamEvent = { type: 'page-done', pageIndex: page.pageIndex }
        onProgress(event)
      }
    } catch (error) {
      // Emit error event
      if (onProgress) {
        const event: StreamEvent = {
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
          pageIndex: page.pageIndex,
        }
        onProgress(event)
      }
      throw error
    }
  }

  // Emit done event
  if (onProgress) {
    const event: StreamEvent = { type: 'done', totalPages }
    onProgress(event)
  }

  // Combine results with configurable separator
  const separator = options.pageSeparator ?? DEFAULT_MARKDOWN_PAGE_SEPARATOR
  const content = results.map((r) => r.content).join(separator)
  const totalUsage = results.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  )
  const cost: CostBreakdown = results.reduce(
    (acc, r) => ({
      total: acc.total + r.cost.total,
      input: (acc.input ?? 0) + (r.cost.input ?? 0),
      output: (acc.output ?? 0) + (r.cost.output ?? 0),
      cached:
        acc.cached != null || r.cost.cached != null
          ? (acc.cached ?? 0) + (r.cost.cached ?? 0)
          : undefined,
      reasoning:
        acc.reasoning != null || r.cost.reasoning != null
          ? (acc.reasoning ?? 0) + (r.cost.reasoning ?? 0)
          : undefined,
    }),
    { total: 0, input: 0, output: 0 } as CostBreakdown,
  )

  return {
    content,
    pages: results,
    totalUsage,
    cost,
  }
}

/**
 * Format extracted text as markdown using LLM
 *
 * This is the main entry point for markdown formatting.
 *
 * @example
 * ```typescript
 * const result = await formatAsMarkdown(
 *   [{ text: 'Hello world', pageIndex: 0 }],
 *   { format: 'markdown', llm: { provider: 'openai' } }
 * )
 * console.log(result.content)
 * ```
 */
export async function formatAsMarkdown(
  pages: PageInput[],
  options: LlmFormatOptions,
): Promise<DocumentFormatResult> {
  const { logger, tracer } = obs('ai')

  return tracer.startSpan(SpanNames.AI_FORMAT, async (span) => {
    span.setAttribute('pageCount', pages.length)
    span.setAttribute('format', options.format)

    if (options.format !== 'markdown') {
      logger.error({ format: options.format }, 'Invalid format for markdown formatting')
      throw new Error(`Invalid format: ${options.format}. Expected 'markdown'.`)
    }

    logger.info({ pageCount: pages.length }, 'Starting LLM markdown formatting')
    const result = await formatPages(pages, options)

    span.setAttribute('totalInputTokens', result.totalUsage.inputTokens)
    span.setAttribute('totalOutputTokens', result.totalUsage.outputTokens)

    return result
  })
}
