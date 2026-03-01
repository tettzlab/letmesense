/**
 * Provider-aware vision processing for Office documents.
 * Automatically uses PDF-direct mode for Anthropic/Google, image mode for OpenAI.
 */

import type {
  CostEstimate,
  FormatRequest,
  FormatResponse,
  LlmConfig,
  LlmProvider,
  ProviderId,
} from '../../ai/config.js'
import { estimateCost } from '../../ai/cost.js'
import { calculateEntryCost, createJournalEntry } from '../../ai/journal.js'
import { modelSupportsPdf } from '../../ai/models.js'
import { DEFAULT_VISION_PROMPT } from '../../ai/prompts.js'
import { resolveProvider } from '../../ai/provider.js'
import type { JournalCallback } from '../../ai/types.js'
import { obs, SemanticAttributes } from '../../observability/index.js'
import type { OfficeUnitContext } from '../../pipeline/types.js'
import { Metrics, Spans } from '../signals.js'
import type { ContentKind, OfficeFormat } from '../types.js'
import {
  ADAPTIVE_DIMENSIONS,
  convertDocumentToPdf,
  DEFAULT_MAX_DIMENSION,
  renderDocumentToImages,
} from './render.js'
import type { VisionContent, VisionProgressCallback, VisionResult } from './types.js'

/** Options for vision formatting */
export interface VisionFormatOptions {
  /** LLM configuration */
  llm?: Partial<LlmConfig>
  /** Custom system prompt */
  systemPrompt?: string
  /** Progress callback */
  onProgress?: VisionProgressCallback
  /** Suppress cost warnings */
  quiet?: boolean
  /** Keep temporary files */
  keepTemp?: boolean
  /** Maximum image dimension (long edge) in pixels. Default: 1024 */
  maxImageDimension?: number
  /** Disable adaptive scaling based on content type. When true, uses fixed maxImageDimension for all pages */
  disableAdaptiveScaling?: boolean
  /** Experiment name for journaling */
  experiment?: string
  /** Journal callback for logging LLM calls */
  onJournal?: JournalCallback
}

/** Result from vision formatting */
export interface VisionFormatResult {
  /** Combined markdown content */
  content: string
  /** Per-unit results */
  results: VisionResult[]
  /** Total token usage */
  usage: {
    inputTokens: number
    outputTokens: number
  }
  /** Whether PDF-direct mode was used */
  usedPdfDirect: boolean
}

/**
 * Get unit label based on format and index.
 */
function getUnitLabel(format: OfficeFormat, index: number): string {
  switch (format) {
    case 'pptx':
    case 'odp':
      return `Slide ${index + 1}`
    case 'xlsx':
    case 'ods':
      return `Sheet ${index + 1}`
    case 'docx':
    case 'odt':
      return `Section ${index + 1}`
    default:
      return `Unit ${index + 1}`
  }
}

/**
 * Create content attributes for a unit.
 */
function createAttributes(
  index: number,
  label: string,
  text: string,
  kind: ContentKind = 'text-only',
): {
  unitIndex: number
  unitLabel: string
  kind: ContentKind
  charCount: number
  imageCount: number
  textSample: string
  language: string
  hasTable: boolean
} {
  return {
    unitIndex: index,
    unitLabel: label,
    kind,
    charCount: text.length,
    imageCount: 0,
    textSample: text.slice(0, 400),
    language: 'eng',
    hasTable: kind === 'tabular',
  }
}

/**
 * Prepare vision content from document.
 * Automatically selects PDF-direct or image mode based on provider capabilities.
 *
 * @param inputPath - Path to the Office document
 * @param extractedTexts - Array of extracted text per unit
 * @param format - Office format
 * @param options - Vision format options (includes maxImageDimension and disableAdaptiveScaling)
 * @param onProgress - Progress callback
 * @param contentKinds - Optional array of content kinds for adaptive scaling (one per unit)
 */
export async function prepareVisionContent(
  inputPath: string,
  extractedTexts: string[],
  format: OfficeFormat,
  options: VisionFormatOptions = {},
  onProgress?: VisionProgressCallback,
  contentKinds?: ContentKind[],
): Promise<{ contents: VisionContent[]; usePdfDirect: boolean }> {
  // Resolve provider and model to check capabilities
  const provider = resolveProvider(options.llm)
  const model = options.llm?.model ?? provider.defaultVisionModel
  const usePdfDirect = modelSupportsPdf(model)

  if (usePdfDirect) {
    // PDF-direct mode (models that accept PDF input)
    const { pdfBytes } = await convertDocumentToPdf(inputPath, options, onProgress)

    // For simplicity, assume 1:1 mapping between units and pages
    // (PPTX slides = pages, XLSX sheets may span pages)
    const contents: VisionContent[] = extractedTexts.map((text, i) => {
      const label = getUnitLabel(format, i)
      const kind = contentKinds?.[i] ?? 'text-only'
      return {
        unitIndex: i,
        unitLabel: label,
        extractedText: text,
        pdfBytes,
        pdfPageRange: { start: i + 1, end: i + 1 },
        embeddedImages: [],
        attributes: createAttributes(i, label, text, kind),
      }
    })

    return { contents, usePdfDirect: true }
  } else {
    // Image mode (OpenAI, Ollama) - pass content kinds for adaptive scaling
    const visionOptions = {
      ...options,
      maxImageDimension: options.maxImageDimension,
      disableAdaptiveScaling: options.disableAdaptiveScaling,
    }
    const images = await renderDocumentToImages(inputPath, visionOptions, onProgress, contentKinds)

    const contents: VisionContent[] = extractedTexts.map((text, i) => {
      const label = getUnitLabel(format, i)
      const kind = contentKinds?.[i] ?? 'text-only'
      return {
        unitIndex: i,
        unitLabel: label,
        extractedText: text,
        renderedImage: images[i],
        embeddedImages: [],
        attributes: createAttributes(i, label, text, kind),
      }
    })

    return { contents, usePdfDirect: false }
  }
}

/**
 * Compute estimated image dimensions for a content unit based on adaptive scaling.
 */
function computeEstimatedDimensions(
  kind: ContentKind | undefined,
  options: VisionFormatOptions,
): { width: number; height: number } {
  // Determine target dimension (long edge)
  let targetDimension: number
  if (options.disableAdaptiveScaling || !kind) {
    targetDimension = options.maxImageDimension ?? DEFAULT_MAX_DIMENSION
  } else {
    const adaptiveDimension = ADAPTIVE_DIMENSIONS[kind]
    targetDimension = options.maxImageDimension
      ? Math.min(adaptiveDimension, options.maxImageDimension)
      : adaptiveDimension
  }

  // Assume typical letter-size aspect ratio (8.5x11 = ~0.77)
  // Long edge is the target, short edge is proportional
  const aspectRatio = 8.5 / 11
  return {
    width: Math.round(targetDimension * aspectRatio),
    height: targetDimension,
  }
}

/**
 * Estimate cost for vision formatting.
 */
export function estimateVisionCost(
  contents: VisionContent[],
  options: VisionFormatOptions = {},
): CostEstimate {
  const provider = resolveProvider(options.llm)
  const model = options.llm?.model ?? provider.defaultVisionModel
  const usePdfDirect = modelSupportsPdf(model)

  // Build pages array for cost estimation with adaptive dimensions
  const pages = contents.map((c) => {
    if (usePdfDirect) {
      // For PDF-direct, we don't have image dimensions
      return {
        text: c.extractedText,
        imageWidth: undefined,
        imageHeight: undefined,
      }
    }

    // For image mode, compute dimensions based on content kind
    const dims = computeEstimatedDimensions(c.attributes?.kind, options)
    return {
      text: c.extractedText,
      imageWidth: dims.width,
      imageHeight: dims.height,
    }
  })

  return estimateCost(
    pages,
    {
      provider: options.llm?.provider ?? provider.name,
      model: options.llm?.model,
    },
    !usePdfDirect, // vision mode for image providers
  )
}

/** Options for formatUnit internal function */
interface FormatUnitOptions {
  onChunk?: (chunk: string) => void
  totalUnits: number
  format: OfficeFormat
  experiment?: string
  onJournal?: JournalCallback
}

/**
 * Format a single content unit using LLM.
 */
async function formatUnit(
  content: VisionContent,
  provider: LlmProvider,
  config: LlmConfig,
  options: FormatUnitOptions,
): Promise<VisionResult> {
  // Build the format request
  const request: FormatRequest = {
    text: content.extractedText,
    context: {
      unitIndex: content.unitIndex,
      unitLabel: content.unitLabel,
    },
  }

  // Add PDF or image based on model capability
  if (config.model && modelSupportsPdf(config.model) && content.pdfBytes) {
    request.pdf = content.pdfBytes
  } else if (content.renderedImage) {
    request.image = content.renderedImage.toString('base64')
  }

  // Measure timing for journaling
  const startTime = performance.now()

  // Call the provider
  let response: FormatResponse
  if (options.onChunk) {
    response = await provider.formatStream(request, config, options.onChunk)
  } else {
    response = await provider.format(request, config)
  }

  const durationMs = Math.round(performance.now() - startTime)

  // Journal the LLM call if experiment is enabled
  if (options.experiment && options.onJournal) {
    // Build office unit context
    const context: OfficeUnitContext = {
      unitIndex: content.unitIndex,
      unitLabel: content.unitLabel,
      format: options.format,
      totalUnits: options.totalUnits,
      contentKind: content.attributes?.kind,
      text: content.extractedText,
    }

    // Use the same prompt that providers use when no promptTemplate is specified
    const pricing = provider.getPricing(config.model ?? provider.defaultModel)
    const cost = calculateEntryCost(response.usage, pricing)

    const entry = createJournalEntry({
      experiment: options.experiment,
      provider: provider.name,
      model: config.model ?? provider.defaultModel,
      promptTemplate: DEFAULT_VISION_PROMPT,
      prompt: DEFAULT_VISION_PROMPT,
      context,
      hasImage: !!content.renderedImage,
      hasPdf: !!content.pdfBytes,
      output: response.content,
      tokens: response.usage,
      cost,
      durationMs,
      imageData: content.renderedImage,
      imageMimeType: content.renderedImage ? 'image/png' : undefined,
    })

    await options.onJournal(entry)
  }

  return {
    unitIndex: content.unitIndex,
    markdown: response.content,
    usage: {
      promptTokens: response.usage.inputTokens,
      completionTokens: response.usage.outputTokens,
      totalTokens: response.usage.inputTokens + response.usage.outputTokens,
    },
  }
}

/**
 * Format Office document content using vision LLM.
 * Automatically uses PDF-direct or image mode based on provider.
 */
export async function formatOfficeWithVision(
  contents: VisionContent[],
  format: OfficeFormat,
  options: VisionFormatOptions = {},
): Promise<VisionFormatResult> {
  const { tracer, metrics, logger } = obs('office.vision')

  return tracer.startSpan(Spans.VISION_FORMAT, async (span) => {
    const start = performance.now()
    span.setAttribute(SemanticAttributes.FORMAT, format)
    span.setAttribute(SemanticAttributes.UNIT_COUNT, contents.length)

    const provider = resolveProvider(options.llm)
    const visionModel = options.llm?.model ?? provider.defaultVisionModel
    const usePdfDirect = modelSupportsPdf(visionModel)

    span.setAttribute(SemanticAttributes.PROVIDER, provider.name)
    span.setAttribute('usePdfDirect', usePdfDirect)

    const config: LlmConfig = {
      provider: provider.name as ProviderId,
      model: visionModel,
      apiKey: options.llm?.apiKey,
      baseUrl: options.llm?.baseUrl,
      timeout: options.llm?.timeout ?? 60_000,
      maxRetries: options.llm?.maxRetries ?? 3,
    }

    span.setAttribute(SemanticAttributes.MODEL, config.model ?? 'default')

    const results: VisionResult[] = []
    let totalInputTokens = 0
    let totalOutputTokens = 0

    options.onProgress?.({ type: 'llm-start', totalUnits: contents.length })

    for (const content of contents) {
      const onChunk = options.onProgress
        ? (chunk: string) => {
            options.onProgress?.({
              type: 'llm-content',
              unitIndex: content.unitIndex,
              content: chunk,
            })
          }
        : undefined

      const result = await formatUnit(content, provider, config, {
        onChunk,
        totalUnits: contents.length,
        format,
        experiment: options.experiment,
        onJournal: options.onJournal,
      })
      results.push(result)

      if (result.usage) {
        totalInputTokens += result.usage.promptTokens
        totalOutputTokens += result.usage.completionTokens
      }

      options.onProgress?.({
        type: 'llm-progress',
        unitIndex: content.unitIndex,
        totalUnits: contents.length,
      })
    }

    options.onProgress?.({ type: 'llm-done', totalUnits: contents.length })

    // Combine all markdown
    const content = results.map((r) => r.markdown).join('\n\n---\n\n')

    const durationMs = performance.now() - start
    span.setAttribute(SemanticAttributes.TOTAL_INPUT_TOKENS, totalInputTokens)
    span.setAttribute(SemanticAttributes.TOTAL_OUTPUT_TOKENS, totalOutputTokens)
    span.setAttribute(SemanticAttributes.DURATION_MS, Math.round(durationMs))

    metrics.counter(Metrics.VISION_PROCESS_COUNT).add(1, { format, provider: provider.name })
    metrics.histogram(Metrics.VISION_PROCESS_DURATION_MS).record(durationMs, { format })
    logger.debug(
      { format, unitCount: contents.length, totalInputTokens, totalOutputTokens, durationMs },
      'Vision formatting complete',
    )

    return {
      content,
      results,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
      usedPdfDirect: usePdfDirect,
    }
  })
}
