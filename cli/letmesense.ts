#!/usr/bin/env node
/**
 * Unified CLI for document text extraction.
 *
 * Supports: PDF, DOCX, PPTX, XLSX, ODT, ODP, ODS, PNG, JPG, GIF, WebP, SVG
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
import { fileURLToPath } from 'node:url'
import { program } from 'commander'
import pino from 'pino'
import { parseModelSpec } from '../lib/ai/config.js'
import type { Observability, ObservabilityFactory, Span } from '../lib/observability/index.js'
import { createObservability, setObservabilityFactory } from '../lib/observability/index.js'
import { SemanticMetrics } from '../lib/observability/types.js'

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
  : createNoopObservabilityFactory()

/**
 * Create a minimal observability factory for CLI that writes logs to stderr only.
 * Used when OTEL is not configured.
 */
function createNoopObservabilityFactory(): ObservabilityFactory {
  const stderrLogger = pino(
    {
      level: process.env.LOG_LEVEL ?? 'warn',
      base: { service: 'letmesense' },
    },
    pino.destination({ dest: 2, sync: true }), // fd 2 = stderr
  )

  return {
    async init() {},
    async shutdown() {},
    create(domain: string) {
      return {
        logger: stderrLogger.child({ domain }),
        tracer: {
          async startSpan<T>(_name: string, fn: (span: Span) => Promise<T>): Promise<T> {
            const span: Span = {
              setAttribute() {},
              setAttributes() {},
              recordException() {},
              setError() {},
              addEvent() {},
              end() {},
            }
            return fn(span)
          },
        },
        metrics: {
          counter() {
            return { add() {} }
          },
          histogram() {
            return { record() {} }
          },
          gauge() {
            return {
              set() {},
              get() {
                return 0
              },
            }
          },
        },
      }
    },
  }
}

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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let VERSION = '0.0.0'
try {
  const packageJson = JSON.parse(
    await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf-8'),
  )
  VERSION = packageJson.version ?? '0.0.0'
} catch {
  // Fallback
}

// ============================================================================
// Exit Codes
// ============================================================================

const EXIT_SUCCESS = 0
const EXIT_INPUT_ERROR = 1
const EXIT_PROCESSING_ERROR = 2

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
  const { getDefaultRegistry } = await import('../lib/pipeline/registry.js')
  return getDefaultRegistry()
}

// ============================================================================
// Helpers
// ============================================================================

function log(message: string, quiet: boolean): void {
  if (!quiet) {
    console.error(message)
  }
}

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

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function validateOutputPath(outputPath: string): Promise<void> {
  try {
    const outputStat = await fs.stat(outputPath)
    if (outputStat.isDirectory()) {
      console.error(`Error: Output path '${outputPath}' is a directory`)
      process.exit(EXIT_INPUT_ERROR)
    }
  } catch {
    // File doesn't exist yet
  }

  const parentDir = path.dirname(outputPath)
  try {
    const stat = await fs.stat(parentDir)
    if (!stat.isDirectory()) {
      console.error(`Error: Output path parent '${parentDir}' is not a directory`)
      process.exit(EXIT_INPUT_ERROR)
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`Error: Output directory '${parentDir}' does not exist`)
      process.exit(EXIT_INPUT_ERROR)
    }
    throw err
  }
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

  metrics
    .counter(SemanticMetrics.CLI_COMMANDS_COUNT)
    .add(1, { mode, status, ...(format && { format }) })
  metrics.histogram(SemanticMetrics.CLI_DURATION_MS).record(durationMs, { mode, status })

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
}

// ============================================================================
// Main CLI
// ============================================================================

program
  .name('letmesense')
  .description('Extract text from documents (PDF, Office, Images)')
  .version(VERSION)
  .argument('<input>', 'File path, URL, or - for stdin')

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
  export GOOGLE_GENERATIVE_AI_API_KEY="..."
`,
  )

  .action(async (input: string, opts: CliOptions) => {
    // Initialize observability (starts OTEL SDK if configured)
    await cliObsFactory.init()

    const { logger, tracer, metrics } = getObs()
    const startTime = performance.now()

    // Determine mode for metrics
    const mode = opts.vision ? 'vision' : opts.llm ? 'llm' : 'extract'

    try {
      await tracer.startSpan('cli.command', async (span) => {
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

        // Get the registry and processor
        const registry = await getRegistry()
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
          if (!opts.inputFormat) {
            console.error('Error: --input-format is required when reading from stdin')
            await exitWithCode(EXIT_INPUT_ERROR, metrics, mode, startTime)
            return
          }
          // Convert Buffer to Uint8Array as required by pipeline
          inputData = new Uint8Array(stdinBuffer)
        }

        // Detect format
        const detected = registry.detectFormat(inputData, {
          format: opts.inputFormat as import('../lib/pipeline/types.js').FormatId | undefined,
        })
        if (!detected) {
          console.error('Error: Unable to detect format. Use --input-format to specify.')
          await exitWithCode(EXIT_INPUT_ERROR, metrics, mode, startTime)
          return
        }

        const { format } = detected
        span.setAttribute('format', format)
        log(`Format: ${format}`, opts.quiet)
        logger.info({ input, format, mode }, 'CLI command started')

        // Handle vision mode
        if (opts.vision) {
          if (format === 'image') {
            // Images go directly to vision LLM
            await handleImageAnalysis(input, opts)
          } else {
            // Documents are rendered to images first
            await handleVisionMode(input, opts)
          }
          await exitWithCode(EXIT_SUCCESS, metrics, 'vision', startTime, format)
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
          slideRange: opts.slides,
          sheetNames: opts.sheets,
          headers: opts.headers,
          // Image options
          maxDimension: opts.maxDimension,
          quality: opts.quality,
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

        span.setAttribute('unitCount', result.unitCount)
        span.setAttribute('runCount', result.runCount)
        span.setAttribute('errorCount', result.errors.length)

        // Handle LLM formatting with individual units
        let finalText = result.text
        if (useLlm && !opts.vision && units) {
          finalText = await handleLlmFormatting(units, opts, streamingMode, input, outputPath)
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
              format: format,
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
        span.setAttribute('durationMs', durationMs)
        logger.info(
          { format, mode, unitCount: result.unitCount, durationMs },
          'CLI command completed',
        )

        await exitWithCode(EXIT_SUCCESS, metrics, mode, startTime, format)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      logger.error({ err, input, mode }, 'CLI command failed')
      await exitWithCode(EXIT_PROCESSING_ERROR, metrics, mode, startTime)
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
  _outputPath?: string,
): Promise<string> {
  const { formatAsMarkdown, estimateFormatCost } = await import('../lib/ai/format.js')
  const { detectProvider, resolveProvider, buildConfig, formatCostWarning } = await import(
    '../lib/ai/index.js'
  )
  const { createFileJournal, createMarkdownJournal, getJournalPath, getMarkdownJournalPath } =
    await import('../lib/ai/journal.js')
  type PageInput = import('../lib/ai/format.js').PageInput

  // Register all providers
  const { registerAllProviders } = await import('../lib/ai/providers.js')
  registerAllProviders()

  // Check provider availability
  const detected = detectProvider()
  if (!detected && !opts.model) {
    console.error(
      'Error: No LLM provider available.\n' +
        'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or configure Ollama.\n' +
        'Or specify a model with --model (e.g., --model openai:mini)',
    )
    process.exit(EXIT_INPUT_ERROR)
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
  type ProviderId = 'openai' | 'anthropic' | 'google' | 'ollama'
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
      process.exit(EXIT_SUCCESS)
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

async function handleVisionMode(input: string, opts: CliOptions): Promise<void> {
  const { PipelineProcessor } = await import('../lib/pipeline/processor.js')
  const { parseModelSpec } = await import('../lib/ai/config.js')
  const { getProvider, detectProvider, resolveProvider } = await import('../lib/ai/provider.js')
  const { createFileJournal, createMarkdownJournal, getJournalPath, getMarkdownJournalPath } =
    await import('../lib/ai/journal.js')

  // Register all providers
  const { registerAllProviders } = await import('../lib/ai/providers.js')
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
          'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY.\n' +
          'Or specify a model with -m (e.g., -m openai:mini)',
      )
      process.exit(EXIT_INPUT_ERROR)
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
      const costMessage = `Estimated cost per page: ~$${(inputCost + outputCost).toFixed(4)} (${providerName}:${modelName})`

      const confirmed = await confirmPrompt(costMessage)
      if (!confirmed) {
        console.error('Cancelled.')
        process.exit(EXIT_SUCCESS)
      }
    }
  }

  log(`Processing with vision: ${input}`, opts.quiet)
  log(`Using model: ${visionModel}`, opts.quiet)

  // Create journal callback if journal is enabled
  let onJournal: import('../lib/ai/types.js').JournalCallback | undefined
  const journalName = opts.journal ? generateJournalName(input, opts.journalTag) : undefined
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

  try {
    let fileStream: ReturnType<typeof createWriteStream> | undefined
    if (streamingMode && outputPath) {
      fileStream = createWriteStream(outputPath, { encoding: 'utf-8' })
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
      slideRange: opts.slides,
      sheetNames: opts.sheets,
      headers: opts.headers,
      // Image options
      maxDimension: opts.maxDimension,
      quality: opts.quality,
    })) {
      switch (chunk.type) {
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

    // Finalize output
    if (streamingMode) {
      if (fileStream) {
        fileStream.end()
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

    process.exit(EXIT_SUCCESS)
  } catch (err) {
    console.error(`\nVision error: ${err instanceof Error ? err.message : err}`)
    process.exit(EXIT_PROCESSING_ERROR)
  }
}

// ============================================================================
// Image Analysis Handler
// ============================================================================

async function handleImageAnalysis(input: string, opts: CliOptions): Promise<void> {
  const { runViewImage } = await import('../lib/images/viewImage.js')
  const { analyzeImageStreaming, createVisionModel } = await import('../lib/images/vision.js')
  const { createFileJournal, createMarkdownJournal, getJournalPath, getMarkdownJournalPath } =
    await import('../lib/ai/journal.js')
  const { parseModelSpec } = await import('../lib/ai/config.js')
  const { getProvider, detectProvider, resolveProvider } = await import('../lib/ai/provider.js')
  const { estimateImageTokens } = await import('../lib/ai/cost.js')

  // Register all providers
  const { registerAllProviders } = await import('../lib/ai/providers.js')
  registerAllProviders()

  const outputPath = opts.output === '-' ? undefined : opts.output
  const streamingMode = shouldStream({ ...opts, output: outputPath })

  // Resolve model: explicit --model or auto-detect from API keys
  let visionModelSpec: string
  if (opts.model) {
    visionModelSpec = `${opts.model.provider}:${opts.model.model}`
  } else {
    const detected = detectProvider()
    if (!detected) {
      console.error(
        'Error: No LLM provider available.\n' +
          'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY.\n' +
          'Or specify a model with -m (e.g., -m openai:mini)',
      )
      process.exit(EXIT_INPUT_ERROR)
    }
    const provider = resolveProvider({ provider: detected.provider })
    visionModelSpec = `${detected.provider}:${provider.defaultVisionModel}`
    log(`Auto-detected provider: ${detected.provider}`, opts.quiet)
  }

  // Create vision model
  const { model, providerOptions, error: modelError } = createVisionModel(visionModelSpec)
  if (modelError || !model) {
    console.error(`Error: ${modelError ?? 'Failed to create vision model'}`)
    process.exit(EXIT_INPUT_ERROR)
  }

  log(`Processing: ${input}`, opts.quiet)

  // Load and process image
  const inputPath = path.resolve(input)
  const result = await runViewImage(inputPath, {
    filePath: input,
    maxDimension: opts.maxDimension,
    quality: opts.quality,
  })

  if (!result.ok) {
    console.error(`Error: ${result.error}`)
    process.exit(EXIT_PROCESSING_ERROR)
  }
  if (!result.data) {
    console.error('Error: Failed to load image data')
    process.exit(EXIT_PROCESSING_ERROR)
  }

  // Estimate cost
  if (!opts.quiet) {
    const { provider: providerName, modelId } = parseModelSpec(visionModelSpec)
    const provider = getProvider(providerName)
    if (provider) {
      const modelName = modelId || provider.defaultVisionModel
      const pricing = provider.getPricing(modelName)
      const imageTokens = estimateImageTokens(
        result.outputWidth ?? result.width,
        result.outputHeight ?? result.height,
      )
      const inputCost = ((100 + imageTokens) / 1_000_000) * pricing.input
      const outputCost = (500 / 1_000_000) * pricing.output
      const costMessage = `Estimated cost: ~$${(inputCost + outputCost).toFixed(4)} (${providerName}:${modelName})`

      if (!opts.yes) {
        const confirmed = await confirmPrompt(costMessage)
        if (!confirmed) {
          console.error('Cancelled.')
          process.exit(EXIT_SUCCESS)
        }
      } else {
        console.error(costMessage)
      }
    }
  }

  log(`Analyzing with ${visionModelSpec}...`, opts.quiet)

  // Set up journaling
  let onJournal: import('../lib/ai/types.js').JournalCallback | undefined
  const journalName = opts.journal ? generateJournalName(input, opts.journalTag) : undefined
  if (journalName) {
    if (opts.journalFormat === 'markdown') {
      onJournal = await createMarkdownJournal(opts.journalDir, journalName)
      log(`Journaling to: ${getMarkdownJournalPath(opts.journalDir, journalName)}`, opts.quiet)
    } else {
      onJournal = await createFileJournal(opts.journalDir, journalName)
      log(`Journaling to: ${getJournalPath(opts.journalDir, journalName)}`, opts.quiet)
    }
  }

  // Analyze image
  const analysisOpts = {
    imageData: result.data,
    mimeType: result.mimeType ?? 'image/png',
    prompt: opts.prompt,
    model,
    experiment: journalName,
    onJournal,
    filePath: input,
    width: result.outputWidth ?? result.width,
    height: result.outputHeight ?? result.height,
    providerOptions,
  }

  try {
    if (streamingMode) {
      let fileStream: ReturnType<typeof createWriteStream> | undefined
      if (outputPath) {
        fileStream = createWriteStream(outputPath, { encoding: 'utf-8' })
      }

      for await (const chunk of analyzeImageStreaming(analysisOpts)) {
        if (fileStream) {
          fileStream.write(chunk)
        } else {
          process.stdout.write(chunk)
        }
      }

      if (fileStream) {
        fileStream.write('\n')
        fileStream.end()
        log(`Output streamed to: ${outputPath}`, opts.quiet)
      } else {
        console.log()
      }
    } else {
      const chunks: string[] = []
      for await (const chunk of analyzeImageStreaming(analysisOpts)) {
        chunks.push(chunk)
      }
      const output = `${chunks.join('')}\n`

      if (outputPath) {
        await fs.writeFile(outputPath, output, 'utf-8')
        log(`Output written to: ${outputPath}`, opts.quiet)
      } else {
        process.stdout.write(output)
      }
    }

    process.exit(EXIT_SUCCESS)
  } catch (err) {
    console.error(`\nVision analysis error: ${err instanceof Error ? err.message : err}`)
    process.exit(EXIT_PROCESSING_ERROR)
  }
}

// ============================================================================
// Parse
// ============================================================================

program.parse()
