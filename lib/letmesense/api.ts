/**
 * High-level library API for letmesense.
 *
 * Provides the same functionality as the CLI but with better ergonomics
 * for programmatic use. Host applications can use this instead of shelling
 * out to the CLI.
 *
 * @example
 * ```ts
 * import { sense, senseStream } from 'letmesense'
 *
 * // Basic extraction
 * const result = await sense('document.pdf')
 * console.log(result.text)
 *
 * // With LLM formatting
 * const formatted = await sense('document.pdf', { llm: true })
 *
 * // Vision mode with streaming
 * for await (const chunk of senseStream('slides.pptx', { vision: true })) {
 *   if (chunk.type === 'content') process.stdout.write(chunk.content)
 * }
 * ```
 */

import { type ProviderId, parseModelSpec } from '../ai/config.js'
import { buildProviderOptions } from '../ai/providerOptions.js'
import { resolveModel as resolveModelFull } from '../ai/resolve.js'
import type {
  JournalCallback,
  JournalEntry,
  LlmFormatOptions,
  OnProgressCallback,
  TokenUsage,
} from '../ai/types.js'
import type {
  DocumentInput,
  ExtractAllOptions,
  ExtractionResult,
  FormatId,
  PromptPreset,
  UnitError,
  VisionChunk,
} from '../pipeline/types.js'

// ============================================================================
// Options Types
// ============================================================================

/**
 * LLM configuration for text formatting.
 */
export interface LlmOptions {
  /**
   * Model specification as 'provider:model'.
   * If omitted, auto-detects from available API keys.
   * @example 'openai:gpt-4o', 'anthropic:sonnet', 'google:gemini-2.0-flash'
   */
  model?: string

  /**
   * Custom prompt for LLM processing.
   * If provided, overrides the default prompt.
   * The extracted text placeholder `{text}` is automatically appended
   * (i.e. the final template becomes `${prompt}\n\n{text}`).
   * Use `promptFile` for full control over the template.
   */
  prompt?: string

  /**
   * Path to a prompt template file.
   * The file content is used as the prompt template verbatim.
   * Must include `{text}` placeholder where extracted text should appear.
   */
  promptFile?: string
}

/**
 * Vision mode configuration.
 * Extends LLM options with rendering settings.
 */
export interface VisionOptions extends LlmOptions {
  /**
   * Scale factor for rendering pages to images.
   * Higher values = better quality but more tokens.
   * @default 2
   */
  renderScale?: number

  /**
   * Playwright rendering mode for PDF pages.
   * - 'always': Always use Playwright (best CJK font support)
   * - 'auto': Auto-detect CJK and use Playwright when needed
   * - 'none': Never use Playwright (fastest)
   * @default 'auto'
   */
  playwright?: 'always' | 'auto' | 'none'

  /**
   * Built-in prompt preset to use.
   * Ignored if `prompt` is provided.
   */
  promptPreset?: PromptPreset
}

/**
 * Main options for the sense() function.
 * Mirrors CLI options with TypeScript types.
 */
export interface SenseOptions {
  // ──────────────────────────────────────────────────────────────────────────
  // Input Options
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Override format detection.
   * Required when input is a buffer without file extension.
   */
  format?: FormatId

  // ──────────────────────────────────────────────────────────────────────────
  // Extraction Options
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Separator between document units (pages, slides, etc.).
   * @default '\n\n'
   */
  separator?: string

  /**
   * Enable parallel extraction for better performance.
   * @default true
   */
  parallel?: boolean

  /**
   * Throw on first error instead of collecting errors.
   * @default false
   */
  strict?: boolean

  /**
   * AbortSignal for cancellation support.
   */
  signal?: AbortSignal

  // ──────────────────────────────────────────────────────────────────────────
  // PDF Options
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * OCR language code(s) for scanned pages.
   * Use '+' to combine languages: 'eng+jpn'
   * @default 'eng'
   */
  ocrLanguage?: string

  // ──────────────────────────────────────────────────────────────────────────
  // Office Options
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Include speaker notes from PowerPoint slides.
   * @default false
   */
  includeNotes?: boolean

  /**
   * Extract only specific slides (PPTX).
   * @example '1-5,7,9-12'
   */
  slides?: string

  /**
   * Extract only specific sheets by name (XLSX).
   * Comma-separated list of sheet names.
   */
  sheets?: string

  /**
   * Treat first row as headers (XLSX).
   * @default false
   */
  headers?: boolean

  // ──────────────────────────────────────────────────────────────────────────
  // Image Options
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Maximum dimension for image resizing.
   * Images larger than this are scaled down.
   * @default 1024
   */
  maxDimension?: number

  /**
   * JPEG/WebP quality for image compression.
   * @default 85
   */
  quality?: number

  // ──────────────────────────────────────────────────────────────────────────
  // LLM Options
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Enable LLM-enhanced markdown formatting.
   * Pass `true` to use auto-detected model, or provide options.
   * Cannot be used together with `vision`.
   */
  llm?: boolean | LlmOptions

  /**
   * Enable vision mode (render to images, send to LLM).
   * Pass `true` to use auto-detected model, or provide options.
   * When enabled, use `senseStream()` for streaming output.
   * Cannot be used together with `llm`.
   */
  vision?: boolean | VisionOptions

  // ──────────────────────────────────────────────────────────────────────────
  // Output Options
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Include document metadata in result.
   * @default false
   */
  includeMetadata?: boolean

  // ──────────────────────────────────────────────────────────────────────────
  // Callbacks
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Progress callback for extraction phases.
   */
  onProgress?: import('../pipeline/progress.js').ProgressCallback

  /**
   * Journal callback for logging LLM calls.
   * Useful for debugging and cost tracking.
   */
  onJournal?: JournalCallback

  /**
   * Stream event callback for LLM formatting.
   * Called during LLM processing with progress events.
   */
  onLlmProgress?: OnProgressCallback
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Cost breakdown for LLM operations.
 */
export interface CostInfo {
  /** Total cost in USD */
  total: number
  /** Input token cost */
  input?: number
  /** Output token cost */
  output?: number
  /** Cached token cost (if applicable) */
  cached?: number
}

/**
 * Result from sense() function.
 */
export interface SenseResult extends ExtractionResult {
  /**
   * Token usage when LLM was used.
   * Only present when `llm` or `vision` options are enabled.
   */
  tokens?: TokenUsage

  /**
   * Cost breakdown when LLM was used.
   * Only present when `llm` or `vision` options are enabled.
   */
  cost?: CostInfo
}

/**
 * Chunk types emitted by senseStream().
 */
export type SenseChunk = VisionChunk

// ============================================================================
// Internal Helpers
// ============================================================================

let _pluginsLoaded = false
let _providersLoaded = false

async function ensurePluginsLoaded(): Promise<void> {
  if (_pluginsLoaded) return
  await Promise.all([
    import('../formats/pdf/index.js'),
    import('../formats/office/index.js'),
    import('../formats/image/index.js'),
  ])
  _pluginsLoaded = true
}

async function ensureProvidersLoaded(): Promise<void> {
  if (_providersLoaded) return
  const { registerAllProviders } = await import('../ai/providers.js')
  registerAllProviders()
  _providersLoaded = true
}

function normalizeLlmOptions(opt: boolean | LlmOptions | undefined): LlmOptions | undefined {
  if (opt === true) return {}
  if (opt === false || opt === undefined) return undefined
  return opt
}

function normalizeVisionOptions(
  opt: boolean | VisionOptions | undefined,
): VisionOptions | undefined {
  if (opt === true) return {}
  if (opt === false || opt === undefined) return undefined
  return opt
}

/**
 * Build the processor options bag from SenseOptions.
 * Maps API-facing names to plugin-facing names where they differ.
 */
function buildProcessorOptions(options: SenseOptions): ExtractAllOptions {
  return {
    // Common extraction options
    format: options.format,
    separator: options.separator,
    parallel: options.parallel,
    strict: options.strict,
    signal: options.signal,
    ocrLanguage: options.ocrLanguage,
    includeMetadata: options.includeMetadata,
    onProgress: options.onProgress,

    // Office options (slideRange/sheetNames match plugin property names)
    includeNotes: options.includeNotes,
    slideRange: options.slides,
    sheetNames: options.sheets,
    headers: options.headers,

    // Image options
    maxDimension: options.maxDimension,
    quality: options.quality,
  }
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Extract text from a document.
 *
 * This is the main entry point for library users. It provides the same
 * functionality as the CLI with a programmatic interface.
 *
 * @param input - File path, URL, or buffer
 * @param options - Extraction and processing options
 * @returns Extraction result with text and metadata
 *
 * @example
 * ```ts
 * // Basic extraction
 * const result = await sense('document.pdf')
 * console.log(result.text)
 *
 * // From buffer with format specified
 * const buffer = await fs.readFile('doc.pdf')
 * const result = await sense(buffer, { format: 'pdf' })
 *
 * // With LLM formatting
 * const result = await sense('report.pdf', {
 *   llm: { model: 'anthropic:sonnet' }
 * })
 *
 * // With progress tracking
 * const result = await sense('big.pdf', {
 *   onProgress: (event) => console.log(event.phase, event.message)
 * })
 * ```
 */
export async function sense(
  input: DocumentInput,
  options: SenseOptions = {},
): Promise<SenseResult> {
  const llmOpts = normalizeLlmOptions(options.llm)
  const visionOpts = normalizeVisionOptions(options.vision)

  // Mutual exclusion: llm and vision cannot both be set
  if (llmOpts && visionOpts) {
    throw new Error('Cannot use both `llm` and `vision` options simultaneously. Choose one mode.')
  }

  await ensurePluginsLoaded()

  // Detect format/source once, before entering mode-specific paths
  const { describeSource, getDefaultRegistry } = await import('../pipeline/registry.js')
  const source = describeSource(input)
  const detected = getDefaultRegistry().detectFormat(input, { format: options.format })
  const format: FormatId = detected?.format ?? 'pdf'

  const { PipelineProcessor } = await import('../pipeline/processor.js')
  const processor = new PipelineProcessor()

  // Vision mode: collect streamed output
  if (visionOpts) {
    const chunks: string[] = []
    const errors: UnitError[] = []
    let unitCount = 0

    // Accumulate tokens/cost from journal entries
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCost: CostInfo = { total: 0 }

    const wrappedJournal: JournalCallback = async (entry: JournalEntry) => {
      totalInputTokens += entry.tokens.input
      totalOutputTokens += entry.tokens.output
      totalCost = {
        total: totalCost.total + entry.cost.total,
        input: (totalCost.input ?? 0) + (entry.cost.input ?? 0),
        output: (totalCost.output ?? 0) + (entry.cost.output ?? 0),
        cached: (totalCost.cached ?? 0) + (entry.cost.cached ?? 0) || undefined,
      }
      if (options.onJournal) await options.onJournal(entry)
    }

    for await (const chunk of senseStream(input, {
      ...options,
      vision: visionOpts,
      onJournal: wrappedJournal,
    })) {
      switch (chunk.type) {
        case 'unit-start':
          unitCount++
          break
        case 'content':
          chunks.push(chunk.content)
          break
        case 'error':
          errors.push(chunk.error)
          break
      }
    }

    return {
      text: chunks.join(''),
      source,
      format,
      unitCount,
      runCount: unitCount, // In vision mode, each unit is its own run
      errors,
      metadata: options.includeMetadata ? {} : undefined,
      tokens:
        totalInputTokens > 0 || totalOutputTokens > 0
          ? { inputTokens: totalInputTokens, outputTokens: totalOutputTokens }
          : undefined,
      cost: totalCost.total > 0 ? totalCost : undefined,
    }
  }

  // LLM text formatting mode
  if (llmOpts) {
    await ensureProvidersLoaded()

    const { formatAsMarkdown } = await import('../ai/format.js')
    const { detectProvider } = await import('../ai/index.js')
    const fs = await import('node:fs/promises')
    type PageInput = import('../ai/format.js').PageInput

    // Extract units first
    const { units, result } = await processor.extractUnits(input, buildProcessorOptions(options))

    // Check provider availability
    const detectedProvider = detectProvider()
    const modelSpec = llmOpts.model
    if (!detectedProvider && !modelSpec) {
      throw new Error(
        'No LLM provider available. ' +
          'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or specify a model.',
      )
    }

    // Build pages from units
    const pages: PageInput[] = units.map((unit) => ({
      text: unit.text,
      pageIndex: unit.index,
      language: unit.language,
      pageKind: unit.kind,
    }))

    // Load custom prompt
    let promptTemplate: string | undefined
    if (llmOpts.promptFile) {
      promptTemplate = await fs.readFile(llmOpts.promptFile, 'utf-8')
    } else if (llmOpts.prompt) {
      promptTemplate = `${llmOpts.prompt}\n\n{text}`
    }

    // Parse model spec, preserving effort for reasoning models
    let provider: ProviderId | undefined
    let model: string | undefined
    let providerOptions: import('../ai/config.js').ProviderOptions | undefined
    if (modelSpec) {
      const parsed = parseModelSpec(modelSpec)
      provider = parsed.provider
      model = parsed.modelId
      if (parsed.effort) {
        const resolved = resolveModelFull(`${parsed.provider}:${parsed.modelId}:${parsed.effort}`)
        providerOptions = buildProviderOptions(resolved)
      }
    }

    // Build format options
    const formatOptions: LlmFormatOptions = {
      format: 'markdown',
      vision: false,
      llm: { provider, model, providerOptions },
      promptTemplate,
      onJournal: options.onJournal,
      onProgress: options.onLlmProgress,
    }

    // Format with LLM
    const formatted = await formatAsMarkdown(pages, formatOptions)

    return {
      ...result,
      text: formatted.content,
      tokens: {
        inputTokens: formatted.totalUsage.inputTokens,
        outputTokens: formatted.totalUsage.outputTokens,
      },
      cost: {
        total: formatted.cost.total,
        input: formatted.cost.input,
        output: formatted.cost.output,
        cached: formatted.cost.cached,
      },
    }
  }

  // Standard extraction
  const result = await processor.extract(input, buildProcessorOptions(options))

  return result
}

/**
 * Stream extraction results from a document.
 *
 * Use this for vision mode or when you need streaming output.
 * Yields chunks as they're processed by the LLM.
 *
 * @param input - File path, URL, or buffer
 * @param options - Extraction and processing options (must include vision)
 * @yields Chunks of content as they're processed
 *
 * @example
 * ```ts
 * // Stream vision mode output
 * for await (const chunk of senseStream('slides.pptx', { vision: true })) {
 *   switch (chunk.type) {
 *     case 'unit-start':
 *       console.log(`Processing: ${chunk.label}`)
 *       break
 *     case 'content':
 *       process.stdout.write(chunk.content)
 *       break
 *     case 'unit-done':
 *       console.log(` (${chunk.charCount} chars)`)
 *       break
 *     case 'error':
 *       console.error(`Error: ${chunk.error.message}`)
 *       break
 *   }
 * }
 *
 * // With specific model
 * for await (const chunk of senseStream('doc.pdf', {
 *   vision: { model: 'openai:gpt-4o', renderScale: 2 }
 * })) {
 *   // ...
 * }
 * ```
 */
export async function* senseStream(
  input: DocumentInput,
  options: SenseOptions & { vision: true | VisionOptions },
): AsyncGenerator<SenseChunk, void, unknown> {
  await ensurePluginsLoaded()
  await ensureProvidersLoaded()

  const { PipelineProcessor } = await import('../pipeline/processor.js')
  const { detectProvider, resolveProvider } = await import('../ai/index.js')

  // Type constraint guarantees options.vision is truthy here
  const visionOpts = normalizeVisionOptions(options.vision) as VisionOptions

  // Resolve model
  let visionModel: string
  if (visionOpts.model) {
    visionModel = visionOpts.model
  } else {
    const detected = detectProvider()
    if (!detected) {
      throw new Error(
        'No LLM provider available. ' +
          'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or specify a model.',
      )
    }
    const provider = resolveProvider({ provider: detected.provider })
    visionModel = `${detected.provider}:${provider.defaultVisionModel}`
  }

  const processor = new PipelineProcessor()

  yield* processor.extractWithVision(input, {
    ...buildProcessorOptions(options),
    model: visionModel,
    systemPrompt: visionOpts.prompt,
    promptPreset: visionOpts.promptPreset,
    renderScale: visionOpts.renderScale,
    usePlaywright: visionOpts.playwright,
    onJournal: options.onJournal,
    // The vision pipeline gates journaling on experiment being truthy.
    // Default to '_api' so onJournal fires for cost/token tracking.
    experiment: options.onJournal ? '_api' : undefined,
  })
}

/**
 * Estimate cost for LLM processing without running it.
 *
 * @param input - File path, URL, or buffer
 * @param options - Same options as sense()
 * @returns Estimated cost information
 *
 * @example
 * ```ts
 * const estimate = await estimateCost('large-doc.pdf', {
 *   vision: { model: 'openai:gpt-4o' }
 * })
 * console.log(`Estimated cost: $${estimate.cost.total.toFixed(4)}`)
 * ```
 */
export async function estimateCost(
  input: DocumentInput,
  options: SenseOptions,
): Promise<{
  inputTokens: number
  outputTokens: number
  imageTokens: number
  cost: CostInfo
  pageCount: number
  model: string
  provider: string
}> {
  await ensurePluginsLoaded()
  await ensureProvidersLoaded()

  const { PipelineProcessor } = await import('../pipeline/processor.js')
  const { estimateFormatCost } = await import('../ai/format.js')
  const { detectProvider, resolveProvider } = await import('../ai/index.js')

  const processor = new PipelineProcessor()
  const llmOpts = normalizeLlmOptions(options.llm)
  const visionOpts = normalizeVisionOptions(options.vision)

  // Extract units to get page count and content
  const { units } = await processor.extractUnits(input, buildProcessorOptions(options))

  // Resolve provider and model
  const detected = detectProvider()
  const modelSpec = llmOpts?.model ?? visionOpts?.model
  let provider: ProviderId | undefined
  let model: string | undefined

  if (modelSpec) {
    const parsed = parseModelSpec(modelSpec)
    provider = parsed.provider
    model = parsed.modelId
  } else if (detected) {
    provider = detected.provider
    const resolvedProvider = resolveProvider({ provider })
    model = visionOpts ? resolvedProvider.defaultVisionModel : resolvedProvider.defaultModel
  } else {
    throw new Error('No LLM provider available for cost estimation.')
  }

  // Build pages for estimation
  const pages = units.map((unit) => ({
    text: unit.text,
    pageIndex: unit.index,
    language: unit.language,
    pageKind: unit.kind,
  }))

  const estimate = estimateFormatCost(pages, {
    format: 'markdown',
    vision: !!visionOpts,
    llm: { provider, model },
  })

  return {
    inputTokens: estimate.inputTokens,
    outputTokens: estimate.outputTokens,
    imageTokens: estimate.imageTokens,
    cost: {
      total: estimate.totalCost,
    },
    pageCount: units.length,
    model: estimate.model,
    provider: estimate.provider,
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  // AI types
  CostBreakdown,
  JournalCallback,
  JournalEntry,
  LlmConfig,
  OnProgressCallback,
  ProviderId,
  StreamEvent,
  TokenUsage,
} from '../ai/types.js'
export type {
  // Core types
  ContentKind,
  DocumentInput,
  ExtractionResult,
  FormatId,
  // Progress
  ProgressCallback,
  ProgressEvent,
  UnitError,
  VisionChunk,
} from '../pipeline/index.js'
export {
  // Errors
  AbortError,
  AnalyzeError,
  ConvertError,
  ExtractError,
  FormatError,
  isAbortError,
  isPipelineError,
  isRecoverableError,
  LoadError,
  NotImplementedError,
  OcrError,
  ParseError,
  PipelineError,
  type ProcessingPhase,
  RenderError,
} from '../pipeline/index.js'
export type { PromptPreset } from '../pipeline/types.js'
