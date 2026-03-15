#!/usr/bin/env node
/**
 * Unified CLI for document text extraction.
 *
 * Supports: PDF, DOCX, PPTX, XLSX, ODT, ODP, ODS, PNG, JPG, GIF, WebP, SVG, HTML
 *
 * Uses the unified pipeline (PipelineProcessor) for extraction,
 * with optional LLM-enhanced formatting.
 *
 * OTEL Configuration:
 * - When OTEL_EXPORTER_OTLP_ENDPOINT is set, full OTEL tracing/metrics are enabled
 * - Set OTEL_SDK_DISABLED=true to disable OTEL (kill switch)
 * - Traces and metrics are exported to the OTLP endpoint (not stdout)
 * - Logs always go to stderr via Pino
 */

// Conditionally load .env file before other imports
// Check for --dotenv flag early since env vars affect provider detection
if (process.argv.includes('--dotenv')) {
  await import('dotenv/config')
}

import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { program } from 'commander'
import type { ProviderId } from '../lib/ai/config.js'
import { parseModelSpec } from '../lib/ai/config.js'
import { initModelRegistry } from '../lib/ai/models.js'
import type { Observability, ObservabilityFactory } from '../lib/observability/index.js'
import {
  createObservability,
  SemanticAttributes,
  setObservabilityFactory,
} from '../lib/observability/index.js'
import { createNoopObservabilityFactory } from './noop-obs.js'
import {
  CliError,
  EXIT_INPUT_ERROR,
  EXIT_PROCESSING_ERROR,
  EXIT_SUCCESS,
  getBundledModelsPath,
  initModelsAction,
  log,
  readStdin,
  readVersion,
  validateOutputPath,
} from './shared.js'
import { Metrics, Spans } from './signals.js'

// ============================================================================
// Observability - Set up BEFORE importing any modules that use obs()
// ============================================================================

// Enable OTEL when OTLP endpoint is configured, unless explicitly disabled (kill switch)
const otelEnabled =
  !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true'

// Create observability factory based on configuration
const cliObsFactory: ObservabilityFactory = otelEnabled
  ? createObservability({
      service: process.env.OTEL_SERVICE_NAME ?? 'letmesense',
      environment: process.env.NODE_ENV ?? 'production', // Use production to avoid console trace exporter
      logLevel: process.env.LOG_LEVEL ?? 'warn',
      telemetryEnabled: true,
    })
  : createNoopObservabilityFactory('letmesense')

// Set as global singleton so all imported modules use this factory
setObservabilityFactory(cliObsFactory)

function getObs(): Observability {
  return cliObsFactory.create('cli')
}

async function shutdownObs(): Promise<void> {
  await cliObsFactory.shutdown()
}

// ============================================================================
// Version
// ============================================================================

const BUNDLED_MODELS_PATH = getBundledModelsPath(import.meta.url)
const VERSION = await readVersion(import.meta.url)

// ============================================================================
// Imports (lazy loaded for performance)
// ============================================================================

async function getProcessor() {
  const { PipelineProcessor } = await import('../lib/pipeline/processor.js')
  return new PipelineProcessor()
}

async function getRegistry() {
  // Import format plugins to register them
  await import('../lib/formats/pdf/index.js')
  await import('../lib/formats/office/index.js')
  await import('../lib/formats/image/index.js')
  await import('../lib/formats/web/index.js')
  const { getDefaultRegistry } = await import('../lib/pipeline/registry.js')
  return getDefaultRegistry()
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate journal name from input and optional tag.
 * Format: {tag}-{basename}-{timestamp} or {basename}-{timestamp}
 */
function generateJournalName(input: string, tag?: string): string {
  const timestamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, '')
    .replace(/(\d{8})(\d{6})/, '$1-$2')

  const basename = input === '-' ? 'stdin' : path.basename(input, path.extname(input))

  return tag ? `${tag}-${basename}-${timestamp}` : `${basename}-${timestamp}`
}

async function confirmPrompt(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return true
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  })

  return new Promise((resolve) => {
    rl.question(`${message}\nProceed? [Y/n] `, (answer) => {
      rl.close()
      const normalized = answer.trim().toLowerCase()
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes')
    })
  })
}

function shouldStream(opts: { output?: string; stream?: boolean }): boolean {
  if (opts.stream === true) return true
  if (opts.stream === false) return false
  if (opts.output && opts.output !== '-') return false
  return process.stdout.isTTY ?? false
}

async function exitWithCode(
  code: number,
  metrics: ReturnType<typeof getObs>['metrics'],
  mode: string,
  startTime: number,
  format?: string,
): Promise<never> {
  const durationMs = Math.round(performance.now() - startTime)
  const status =
    code === EXIT_SUCCESS ? 'success' : code === EXIT_INPUT_ERROR ? 'input_error' : 'error'

  metrics.counter(Metrics.COMMAND_COUNT).add(1, { mode, status, ...(format && { format }) })
  metrics.histogram(Metrics.DURATION_MS).record(durationMs, { mode, status })

  await shutdownObs()
  process.exit(code)
}

// ============================================================================
// Option Validators
// ============================================================================

function validateOcrLang(value: string): string {
  const normalized = value.toLowerCase()
  const pattern = /^[a-z]{3}(\+[a-z]{3})*$/
  if (!pattern.test(normalized)) {
    console.error(
      `Error: --ocr-lang must be valid Tesseract language codes (e.g., "eng", "eng+jpn")`,
    )
    process.exit(EXIT_INPUT_ERROR)
  }
  return normalized
}

function validateTimeout(value: string): number {
  const num = parseInt(value, 10)
  if (Number.isNaN(num) || num < 1000 || num > 600000) {
    console.error(`Error: --timeout must be between 1000 and 600000 ms`)
    process.exit(EXIT_INPUT_ERROR)
  }
  return num
}

function validateMaxDimension(value: string): number {
  const num = parseInt(value, 10)
  if (Number.isNaN(num) || num < 64 || num > 2048) {
    console.error(`Error: --max-dimension must be between 64 and 2048`)
    process.exit(EXIT_INPUT_ERROR)
  }
  return num
}

function validateQuality(value: string): number {
  const num = parseInt(value, 10)
  if (Number.isNaN(num) || num < 10 || num > 100) {
    console.error(`Error: --quality must be between 10 and 100`)
    process.exit(EXIT_INPUT_ERROR)
  }
  return num
}

function validateMaxRows(value: string): number {
  const num = parseInt(value, 10)
  if (Number.isNaN(num) || num < 0) {
    console.error(`Error: --max-rows must be a non-negative integer`)
    process.exit(EXIT_INPUT_ERROR)
  }
  return num
}

function validateSlideRange(value: string): string {
  const pattern = /^(\d+(-\d+)?)(,\d+(-\d+)?)*$/
  if (!pattern.test(value.trim())) {
    console.error(`Error: --slides must be a valid range (e.g., "1-5,7,9-12")`)
    process.exit(EXIT_INPUT_ERROR)
  }
  return value.trim()
}

function validateModel(value: string): { provider: string; model: string; effort: string | null } {
  try {
    const parsed = parseModelSpec(value)
    return { provider: parsed.provider, model: parsed.modelId, effort: parsed.effort }
  } catch (_err) {
    console.error(
      `Error: Invalid model spec '${value}'. Use format 'provider:model' or 'provider:model:effort'`,
    )
    process.exit(EXIT_INPUT_ERROR)
  }
}

// ============================================================================
// CLI Options Interface
// ============================================================================

interface CliOptions {
  // Common
  output?: string
  json: boolean
  quiet: boolean
  strict: boolean
  separator: string
  timeout: number
  inputFormat?: string

  // PDF-specific
  ocrLang: string
  parallel: boolean

  // Office-specific
  includeNotes: boolean
  slides?: string
  sheets?: string
  headers: boolean
  maxRows: number
  csv: boolean
  tsv: boolean
  ocr: boolean

  // Image-specific
  maxDimension: number
  quality: number
  metadataOnly: boolean
  includeData: boolean
  dataUri: boolean

  // HTML/Web-specific
  links: boolean
  images: boolean

  // LLM options
  llm: boolean
  vision: boolean
  playwright: 'always' | 'auto' | 'none'
  model?: { provider: string; model: string; effort: string | null }
  prompt?: string
  promptFile?: string
  yes: boolean
  stream?: boolean
  journal?: boolean
  journalTag?: string
  journalDir: string
  journalFormat: 'jsonl' | 'markdown'

  // Model registry
  modelsFile?: string
  modelsJson?: string
}

// ============================================================================
// init-models subcommand
// ============================================================================

program
  .name('letmesense')
  .description('Extract text from documents (PDF, Office, Images, HTML)')
  .version(VERSION)

program
  .command('init-models')
  .description('Generate a template models.json in the current directory')
  .argument('[output]', 'Output path', 'models.json')
  .option('--full', 'Copy the full bundled registry instead of a minimal template', false)
  .action(initModelsAction(BUNDLED_MODELS_PATH, 'letmesense doc.pdf --models-file models.json'))

// ============================================================================
// Main command (default)
// ============================================================================

program
  .argument('[input]', 'File path, URL, or - for stdin')

  // Common options
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('-j, --json', 'Output as JSON with metadata', false)
  .option('-q, --quiet', 'Suppress progress messages', false)
  .option('--strict', 'Fail on first error', false)
  .option('--separator <str>', 'Separator between units', '\n\n===\n\n')
  .option('--timeout <ms>', 'URL fetch timeout', validateTimeout, 30000)
  .option(
    '--input-format <fmt>',
    'Specify format for stdin (pdf, docx, pptx, xlsx, png, jpg, etc.)',
  )

  // PDF options
  .option('--ocr-lang <lang>', 'OCR language code', validateOcrLang, 'eng')
  .option('--no-parallel', 'Disable parallel extraction')

  // Office options
  .option('--include-notes', 'Include speaker notes (PPTX)', false)
  .option('--slides <range>', 'Extract specific slides (e.g., 1-5,7,9-12)', validateSlideRange)
  .option('--sheets <names>', 'Extract specific sheets (comma-separated)')
  .option('--headers', 'Treat first row as headers (XLSX)', false)
  .option('--max-rows <n>', 'Max rows for tabular output', validateMaxRows, 50)
  .option('--csv', 'Output as CSV (spreadsheets only)', false)
  .option('--tsv', 'Output as TSV (spreadsheets only)', false)
  .option('--ocr', 'Enable OCR for embedded images', false)

  // Image options
  .option('-d, --max-dimension <n>', 'Max image dimension', validateMaxDimension, 1024)
  .option('--quality <n>', 'JPEG/WebP quality', validateQuality, 85)
  .option('--metadata-only', 'Return only metadata', false)
  .option('--include-data', 'Include base64 data in JSON', false)
  .option('--data-uri', 'Output as data URI', false)

  // HTML/Web options
  .option('--no-links', 'Strip links from HTML output (keep text)')
  .option('--no-images', 'Strip images from HTML output')

  // LLM options
  .option('--llm', 'Enable LLM-enhanced markdown formatting', false)
  .option('--vision', 'Enable vision mode (renders to images, sends to LLM)', false)
  .option('--playwright <mode>', 'Playwright rendering mode: always, auto (default), none', 'auto')
  .option(
    '-m, --model <spec>',
    'LLM model as provider:model (auto-detects if omitted)',
    validateModel,
  )
  .option('-p, --prompt <text>', 'Custom prompt for LLM/vision')
  .option('--prompt-file <file>', 'Custom prompt template file')
  .option('-y, --yes', 'Skip cost confirmation', false)
  .option('--stream', 'Force streaming output')
  .option('--no-stream', 'Force atomic output')
  .option('-J, --journal', 'Enable journaling', false)
  .option('--journal-tag <tag>', 'Journal name tag prefix')
  .option('--journal-dir <path>', 'Journal directory', './experiments')
  .option('--journal-format <fmt>', 'Journal format: jsonl or markdown', 'markdown')
  .option('--dotenv', 'Load environment variables from .env file', false)
  .option('--models-file <path>', 'Path to models.json file (default: bundled)')
  .option('--models-json <json>', 'Raw JSON string for model registry (overrides --models-file)')

  .addHelpText(
    'after',
    `
Examples:
  $ letmesense document.pdf                    # Extract PDF text
  $ letmesense slides.pptx -o out.txt          # Write to file
  $ letmesense data.xlsx --json                # Output JSON
  $ letmesense data.xlsx --csv                 # Output as CSV
  $ cat doc.pdf | letmesense - --input-format pdf

Vision Mode (auto-detects model from API key):
  $ letmesense image.png --vision              # Analyze image with LLM
  $ letmesense scanned.pdf --vision            # OCR via vision LLM
  $ letmesense slides.pptx --vision            # Format slides with vision
  $ letmesense doc.pdf --vision -m openai:mini  # Specify model

LLM Text Formatting:
  $ letmesense doc.pdf --llm                   # Format extracted text
  $ letmesense doc.pdf --llm -m anthropic:sonnet

Provider Configuration (set one to enable auto-detection):
  export OPENAI_API_KEY="sk-..."
  export ANTHROPIC_API_KEY="sk-ant-..."
  export GOOGLE_API_KEY="..."
`,
  )

  .action(async (input: string | undefined, opts: CliOptions) => {
    if (!input) {
      program.help()
      return
    }

    // Initialize observability (starts OTEL SDK if configured)
    await cliObsFactory.init()

    const { logger, tracer, metrics } = getObs()
    const startTime = performance.now()

    // Configure model registry before first access.
    // CLI flags take priority; env vars are checked inside loadModelsJson() as fallback.
    if (opts.modelsJson) {
      initModelRegistry({ json: opts.modelsJson })
    } else if (opts.modelsFile) {
      initModelRegistry({ file: opts.modelsFile })
    } else if (!process.env.MODELS_JSON && !process.env.MODELS_FILE) {
      initModelRegistry({ file: BUNDLED_MODELS_PATH })
    }

    // Determine mode for metrics
    const mode = opts.vision ? 'vision' : opts.llm ? 'llm' : 'extract'

    try {
      await tracer.startSpan(Spans.COMMAND, async (span) => {
        span.setAttribute('mode', mode)
        span.setAttribute('input', input === '-' ? 'stdin' : input)

        // Normalize options
        const useLlm = opts.llm || opts.vision
        const outputPath = opts.output === '-' ? undefined : opts.output
        const streamingMode = shouldStream({ ...opts, output: outputPath })

        // Validate conflicting options
        if ((opts.csv || opts.tsv) && useLlm) {
          console.error('Error: --csv/--tsv cannot be used with --llm/--vision')
          await exitWithCode(EXIT_INPUT_ERROR, metrics, mode, startTime)
          return
        }

        const outputFormats = [opts.json, opts.csv, opts.tsv].filter(Boolean).length
        if (outputFormats > 1) {
          console.error('Error: Mutually exclusive output formats: --json, --csv, --tsv')
          await exitWithCode(EXIT_INPUT_ERROR, metrics, mode, startTime)
          return
        }

        // Validate output path early
        if (outputPath) {
          await validateOutputPath(outputPath)
        }

        // Validate --input-format early for stdin before expensive initialization
        if (input === '-' && !opts.inputFormat) {
          console.error('Error: --input-format is required when reading from stdin')
          await exitWithCode(EXIT_INPUT_ERROR, metrics, mode, startTime)
          return
        }

        // Ensure plugins registered, get processor
        await getRegistry()
        const processor = await getProcessor()

        // Handle stdin
        let inputData: string | Uint8Array = input
        if (input === '-') {
          log('Reading from stdin...', opts.quiet)
          const stdinBuffer = await readStdin()
          if (stdinBuffer.length === 0) {
            console.error('Error: No input received from stdin')
            await exitWithCode(EXIT_INPUT_ERROR, metrics, mode, startTime)
            return
          }
          // Convert Buffer to Uint8Array as required by pipeline
          inputData = new Uint8Array(stdinBuffer)
        }

        logger.info({ input, mode }, 'CLI command started')

        // Handle vision mode
        if (opts.vision) {
          await handleVisionMode(inputData, opts, metrics, startTime)
          return
        }

        // Standard extraction using PipelineProcessor
        log('Extracting text...', opts.quiet)

        const extractOptions = {
          format: opts.inputFormat as import('../lib/pipeline/types.js').FormatId | undefined,
          separator: opts.separator,
          includeMetadata: opts.json,
          strict: opts.strict,
          parallel: opts.parallel,
          ocrLanguage: opts.ocrLang,
          // Office options
          includeNotes: opts.includeNotes,
          slides: opts.slides,
          sheets: opts.sheets,
          headers: opts.headers,
          // Image options
          maxDimension: opts.maxDimension,
          quality: opts.quality,
          // HTML/Web options
          includeLinks: opts.links,
          includeImages: opts.images,
        }

        // Use extractUnits for LLM mode to get per-unit text
        let result: import('../lib/pipeline/types.js').ExtractionResult
        let units: import('../lib/pipeline/types.js').ExtractedUnit[] | undefined

        if (useLlm && !opts.vision) {
          const unitsResult = await processor.extractUnits(inputData, extractOptions)
          result = unitsResult.result
          units = unitsResult.units
        } else {
          result = await processor.extract(inputData, extractOptions)
        }

        span.setAttribute(SemanticAttributes.FORMAT, result.format)
        span.setAttribute(SemanticAttributes.UNIT_COUNT, result.unitCount)
        span.setAttribute(SemanticAttributes.RUN_COUNT, result.runCount)
        span.setAttribute(SemanticAttributes.ERROR_COUNT, result.errors.length)
        log(`Format: ${result.format}`, opts.quiet)

        // Handle LLM formatting with individual units
        let finalText = result.text
        if (useLlm && !opts.vision && units) {
          finalText = await handleLlmFormatting(
            units,
            opts,
            streamingMode,
            input,
            outputPath,
            metrics,
            startTime,
          )
        }

        // Format output
        let output: string
        if (opts.json) {
          output = JSON.stringify({ ...result, text: finalText }, null, 2)
        } else if (opts.csv || opts.tsv) {
          // For spreadsheets, use the office formatter
          // Cast to any to bypass type incompatibilities during transition
          const { formatResult } = await import('../lib/office/formatters/index.js')
          output = formatResult(
            {
              text: result.text,
              source: result.source,
              format: result.format,
              unitCount: result.unitCount,
              runCount: result.runCount,
              errors: result.errors,
              metadata: result.metadata ?? {},
            } as Parameters<typeof formatResult>[0],
            opts.csv ? 'csv' : 'tsv',
            { headers: opts.headers },
          )
        } else {
          output = finalText
        }

        span.setAttribute('outputChars', output.length)

        // Write output
        const finalOutput = output.endsWith('\n') ? output : `${output}\n`
        if (outputPath) {
          await fs.writeFile(outputPath, finalOutput, 'utf-8')
          log(`Output written to ${outputPath}`, opts.quiet)
        } else {
          process.stdout.write(finalOutput)
        }

        // Report errors
        if (result.errors.length > 0 && !opts.quiet) {
          console.error(`\nWarnings: ${result.errors.length} error(s) during extraction:`)
          for (const err of result.errors) {
            console.error(`  - Unit ${err.unitIndex + 1}: ${err.message}`)
          }
        }

        const durationMs = Math.round(performance.now() - startTime)
        span.setAttribute(SemanticAttributes.DURATION_MS, durationMs)
        logger.info(
          { format: result.format, mode, unitCount: result.unitCount, durationMs },
          'CLI command completed',
        )

        await exitWithCode(EXIT_SUCCESS, metrics, mode, startTime, result.format)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      logger.error({ err, input, mode }, 'CLI command failed')
      const exitCode =
        err instanceof CliError
          ? err.exitCode
          : err instanceof Error && err.name === 'LoadError'
            ? EXIT_INPUT_ERROR
            : EXIT_PROCESSING_ERROR
      await exitWithCode(exitCode, metrics, mode, startTime)
    }
  })

// ============================================================================
// LLM Formatting Handler
// ============================================================================

async function handleLlmFormatting(
  units: import('../lib/pipeline/types.js').ExtractedUnit[],
  opts: CliOptions,
  streamingMode: boolean,
  input: string,
  _outputPath: string | undefined,
  metrics: ReturnType<typeof getObs>['metrics'],
  startTime: number,
): Promise<string> {
  const { formatAsMarkdown, estimateFormatCost } = await import('../lib/ai/format.js')
  const { detectProvider, resolveProvider, buildConfig, formatCostWarning } = await import(
    '../lib/ai/index.js'
  )
  const { createFileJournal, createMarkdownJournal, getJournalPath, getMarkdownJournalPath } =
    await import('../lib/ai/journal.js')
  type PageInput = import('../lib/ai/format.js').PageInput

  // Register all providers
  const { registerAllProviders } = await import('../lib/ai/bootstrap.js')
  registerAllProviders()

  // Check provider availability
  const detected = detectProvider()
  if (!detected && !opts.model) {
    console.error(
      'Error: No LLM provider available.\n' +
        'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or configure Ollama.\n' +
        'Or specify a model with --model (e.g., --model openai:mini)',
    )
    await exitWithCode(EXIT_INPUT_ERROR, metrics, 'llm', startTime)
  }

  // Build pages from individual units (not concatenated text)
  const pages: PageInput[] = units.map((unit) => ({
    text: unit.text,
    pageIndex: unit.index,
    language: unit.language,
    pageKind: unit.kind,
  }))

  // Load custom prompt
  let promptTemplate: string | undefined
  if (opts.promptFile) {
    promptTemplate = await fs.readFile(opts.promptFile, 'utf-8')
  } else if (opts.prompt) {
    promptTemplate = `${opts.prompt}\n\n{text}`
  }

  // Create journal callback
  let onJournal: import('../lib/ai/types.js').JournalCallback | undefined
  const journalName = opts.journal ? generateJournalName(input, opts.journalTag) : undefined
  if (journalName) {
    if (opts.journalFormat === 'markdown') {
      onJournal = await createMarkdownJournal(opts.journalDir, journalName)
      log(`Journaling to ${getMarkdownJournalPath(opts.journalDir, journalName)}`, opts.quiet)
    } else {
      onJournal = await createFileJournal(opts.journalDir, journalName)
      log(`Journaling to ${getJournalPath(opts.journalDir, journalName)}`, opts.quiet)
    }
  }

  // Build provider options for reasoning effort
  let providerOptions: import('../lib/ai/config.js').ProviderOptions | undefined
  if (opts.model?.effort && opts.model.provider) {
    const { resolveModel: resolveModelSpec } = await import('../lib/ai/resolve.js')
    const { buildProviderOptions } = await import('../lib/ai/providerOptions.js')
    const resolved = resolveModelSpec(
      `${opts.model.provider}:${opts.model.model}:${opts.model.effort}`,
    )
    providerOptions = buildProviderOptions(resolved)
  }

  // Build format options
  const formatOptions = {
    format: 'markdown' as const,
    vision: false,
    llm: {
      provider: opts.model?.provider as ProviderId | undefined,
      model: opts.model?.model,
      providerOptions,
    },
    promptTemplate,
    experiment: journalName,
    onJournal,
    onProgress: opts.quiet
      ? undefined
      : (event: import('../lib/ai/types.js').StreamEvent) => {
          if (event.type === 'start') {
            console.error(formatCostWarning(event.estimatedCost, event.totalPages, false))
          } else if (event.type === 'content' && streamingMode) {
            process.stdout.write(event.content)
          }
        },
  }

  // Estimate cost and confirm
  if (!opts.quiet && !opts.yes) {
    const llmConfig = formatOptions.llm as { provider?: ProviderId; model?: string }
    const provider = resolveProvider(llmConfig)
    const config = buildConfig(provider, llmConfig, false)
    const estimate = estimateFormatCost(pages, { ...formatOptions, llm: config })
    const warning = formatCostWarning(estimate, pages.length, false)

    const confirmed = await confirmPrompt(warning)
    if (!confirmed) {
      console.error('Cancelled.')
      await exitWithCode(EXIT_SUCCESS, metrics, 'llm', startTime)
    }
  }

  // Format with LLM
  const formatted = await formatAsMarkdown(
    pages,
    formatOptions as import('../lib/ai/types.js').LlmFormatOptions,
  )
  return formatted.content
}

// ============================================================================
// Vision Mode Handler
// ============================================================================

async function handleVisionMode(
  input: string | Uint8Array,
  opts: CliOptions,
  metrics: ReturnType<typeof getObs>['metrics'],
  startTime: number,
): Promise<void> {
  const { PipelineProcessor } = await import('../lib/pipeline/processor.js')
  const { parseModelSpec } = await import('../lib/ai/config.js')
  const { getProvider, detectProvider, resolveProvider } = await import('../lib/ai/provider.js')
  const { createFileJournal, createMarkdownJournal, getJournalPath, getMarkdownJournalPath } =
    await import('../lib/ai/journal.js')

  // Register all providers
  const { registerAllProviders } = await import('../lib/ai/bootstrap.js')
  registerAllProviders()

  // Resolve model: explicit --model or auto-detect from API keys
  let visionModel: string
  if (opts.model) {
    visionModel = `${opts.model.provider}:${opts.model.model}`
  } else {
    const detected = detectProvider()
    if (!detected) {
      console.error(
        'Error: No LLM provider available.\n' +
          'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.\n' +
          'Or specify a model with -m (e.g., -m openai:mini)',
      )
      await exitWithCode(EXIT_INPUT_ERROR, metrics, 'vision', startTime)
      return
    }
    const provider = resolveProvider({ provider: detected.provider })
    visionModel = `${detected.provider}:${provider.defaultVisionModel}`
    log(`Auto-detected provider: ${detected.provider}`, opts.quiet)
  }

  // Estimate cost
  if (!opts.quiet && !opts.yes) {
    const { provider: providerName, modelId } = parseModelSpec(visionModel)
    const provider = getProvider(providerName)
    if (provider) {
      const modelName = modelId || provider.defaultVisionModel
      const pricing = provider.getPricing(modelName)
      // Rough estimate: ~1000 tokens per page image, 500 output
      const inputCost = (1000 / 1_000_000) * pricing.input
      const outputCost = (500 / 1_000_000) * pricing.output
      const costMessage = `Estimated cost per page: ~$${(inputCost + outputCost).toFixed(4)} (${providerName}:${modelName}, approximate — actual charges may vary)`

      const confirmed = await confirmPrompt(costMessage)
      if (!confirmed) {
        console.error('Cancelled.')
        await exitWithCode(EXIT_SUCCESS, metrics, 'vision', startTime)
        return
      }
    }
  }

  const inputLabel = typeof input === 'string' ? input : 'stdin'
  log(`Processing with vision: ${inputLabel}`, opts.quiet)
  log(`Using model: ${visionModel}`, opts.quiet)

  // Create journal callback if journal is enabled
  let onJournal: import('../lib/ai/types.js').JournalCallback | undefined
  const journalName = opts.journal ? generateJournalName(inputLabel, opts.journalTag) : undefined
  if (journalName) {
    if (opts.journalFormat === 'markdown') {
      onJournal = await createMarkdownJournal(opts.journalDir, journalName)
      log(`Journaling to: ${getMarkdownJournalPath(opts.journalDir, journalName)}`, opts.quiet)
    } else {
      onJournal = await createFileJournal(opts.journalDir, journalName)
      log(`Journaling to: ${getJournalPath(opts.journalDir, journalName)}`, opts.quiet)
    }
  }

  const processor = new PipelineProcessor()
  const outputPath = opts.output === '-' ? undefined : opts.output
  const streamingMode = shouldStream({ ...opts, output: outputPath })
  let detectedFormat: import('../lib/pipeline/types.js').FormatId | undefined

  try {
    let fileStream: ReturnType<typeof createWriteStream> | undefined
    let fileStreamError: Error | undefined
    if (streamingMode && outputPath) {
      fileStream = createWriteStream(outputPath, { encoding: 'utf-8' })
      fileStream.on('error', (err) => {
        fileStreamError = new Error(`Write stream error for '${outputPath}': ${err.message}`)
      })
    }

    const chunks: string[] = []
    let currentUnit = -1

    for await (const chunk of processor.extractWithVision(input, {
      format: opts.inputFormat as import('../lib/pipeline/types.js').FormatId | undefined,
      model: visionModel,
      systemPrompt: opts.prompt,
      renderScale: 2,
      experiment: journalName,
      onJournal,
      usePlaywright: opts.playwright,
      ocrLanguage: opts.ocrLang,
      parallel: opts.parallel,
      strict: opts.strict,
      // Office options
      includeNotes: opts.includeNotes,
      slides: opts.slides,
      sheets: opts.sheets,
      headers: opts.headers,
      // Image options
      maxDimension: opts.maxDimension,
      quality: opts.quality,
    })) {
      switch (chunk.type) {
        case 'metadata':
          detectedFormat = chunk.format
          log(`Format: ${chunk.format}`, opts.quiet)
          break

        case 'unit-start':
          if (!opts.quiet) {
            console.error(`\nProcessing: ${chunk.label}`)
          }
          currentUnit = chunk.unitIndex
          break

        case 'content':
          if (streamingMode) {
            if (fileStream) {
              fileStream.write(chunk.content)
            } else {
              process.stdout.write(chunk.content)
            }
          } else {
            chunks.push(chunk.content)
          }
          break

        case 'unit-done':
          if (!opts.quiet) {
            console.error(` (${chunk.charCount} chars)`)
          }
          // Add separator between units
          if (streamingMode && currentUnit >= 0) {
            const sep = '\n\n---\n\n'
            if (fileStream) {
              fileStream.write(sep)
            } else {
              process.stdout.write(sep)
            }
          } else {
            chunks.push('\n\n---\n\n')
          }
          break

        case 'error':
          console.error(`\nError on unit ${chunk.error.unitIndex}: ${chunk.error.message}`)
          break
      }
    }

    if (fileStreamError) throw fileStreamError

    // Finalize output
    if (streamingMode) {
      if (fileStream) {
        fileStream.end()
        await new Promise<void>((resolve) => fileStream?.once('finish', resolve))
        log(`Output streamed to: ${outputPath}`, opts.quiet)
      } else {
        console.log()
      }
    } else {
      // Remove trailing separator
      const output = chunks.join('').replace(/\n\n---\n\n$/, '\n')
      if (outputPath) {
        await fs.writeFile(outputPath, output, 'utf-8')
        log(`Output written to: ${outputPath}`, opts.quiet)
      } else {
        process.stdout.write(output)
      }
    }

    await exitWithCode(EXIT_SUCCESS, metrics, 'vision', startTime, detectedFormat)
  } catch (err) {
    console.error(`\nVision error: ${err instanceof Error ? err.message : err}`)
    await exitWithCode(EXIT_PROCESSING_ERROR, metrics, 'vision', startTime, detectedFormat)
  }
}

// ============================================================================
// Parse
// ============================================================================

program.parse()
