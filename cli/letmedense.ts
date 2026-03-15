#!/usr/bin/env node
/**
 * CLI for condensing long text via LLM map-reduce.
 *
 * Accepts plain text or markdown from a file or stdin,
 * condenses it to a target size using the condense module.
 *
 * OTEL Configuration:
 * - When OTEL_EXPORTER_OTLP_ENDPOINT is set, full OTEL tracing/metrics are enabled
 * - Set OTEL_SDK_DISABLED=true to disable OTEL (kill switch)
 */

// Conditionally load .env file before other imports
if (process.argv.includes('--dotenv')) {
  await import('dotenv/config')
}

import fs from 'node:fs/promises'
import { program } from 'commander'
import type {
  ChunkStrategy,
  CondenseOptions,
  CondenseProgressEvent,
} from '../lib/condense/index.js'
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
// Observability
// ============================================================================

const otelEnabled =
  !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true'

const cliObsFactory: ObservabilityFactory = otelEnabled
  ? createObservability({
      service: process.env.OTEL_SERVICE_NAME ?? 'letmedense',
      environment: process.env.NODE_ENV ?? 'production',
      logLevel: process.env.LOG_LEVEL ?? 'warn',
      telemetryEnabled: true,
    })
  : createNoopObservabilityFactory('letmedense')

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

const VERSION = await readVersion(import.meta.url)

async function exitWithCode(
  code: number,
  metrics: ReturnType<typeof getObs>['metrics'],
  startTime: number,
): Promise<never> {
  const durationMs = Math.round(performance.now() - startTime)
  const status =
    code === EXIT_SUCCESS ? 'success' : code === EXIT_INPUT_ERROR ? 'input_error' : 'error'

  metrics.counter(Metrics.COMMAND_COUNT).add(1, { mode: 'condense', status })
  metrics.histogram(Metrics.DURATION_MS).record(durationMs, { mode: 'condense', status })

  await shutdownObs()
  process.exit(code)
}

// ============================================================================
// Option Validators
// ============================================================================

/**
 * Parse a CLI argument early (before Commander setup).
 * Handles both space-separated (--flag val) and equals-separated (--flag=val) syntax.
 */
function parseEarlyArg(long: string, short?: string): string | undefined {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg.startsWith(`--${long}=`)) return arg.slice(long.length + 3)
    if (short && arg.startsWith(`-${short}=`)) return arg.slice(short.length + 2)
    if (arg === `--${long}` || (short && arg === `-${short}`)) {
      return process.argv[i + 1]
    }
  }
  return undefined
}

// Configure model registry early so it's set before first registry access.
// CLI flags take priority; env vars are checked inside loadModelsJson() as fallback.
import { initModelRegistry } from '../lib/ai/models.js'

const BUNDLED_MODELS_PATH = getBundledModelsPath(import.meta.url)
const earlyModelsJson = parseEarlyArg('models-json')
const earlyModelsFile = parseEarlyArg('models-file')

if (earlyModelsJson) {
  initModelRegistry({ json: earlyModelsJson })
} else if (earlyModelsFile) {
  initModelRegistry({ file: earlyModelsFile })
} else if (!process.env.MODELS_JSON && !process.env.MODELS_FILE) {
  initModelRegistry({ file: BUNDLED_MODELS_PATH })
}

function parsePositiveInt(value: string, name: string): number {
  const num = Number.parseInt(value, 10)
  if (Number.isNaN(num) || num < 1) {
    console.error(`Error: ${name} must be a positive integer`)
    process.exit(EXIT_INPUT_ERROR)
  }
  return num
}

function parseRatio(value: string): number {
  const num = Number.parseFloat(value)
  if (Number.isNaN(num) || num <= 0 || num >= 1) {
    console.error('Error: --ratio must be between 0 and 1 (exclusive)')
    process.exit(EXIT_INPUT_ERROR)
  }
  return num
}

// ============================================================================
// CLI Options Interface
// ============================================================================

interface DenseCliOptions {
  maxChars?: number
  maxTokens?: number
  ratio?: number
  model?: string
  output?: string
  quiet: boolean
  chunkStrategy: ChunkStrategy
  concurrency: number
  maxDepth: number
  json: boolean

  // Model registry (consumed early via parseEarlyArg, not by Commander)
  modelsFile?: string
  modelsJson?: string
}

// ============================================================================
// init-models subcommand
// ============================================================================

program.name('letmedense').description('Condense long text via LLM map-reduce').version(VERSION)

program
  .command('init-models')
  .description('Generate a template models.json in the current directory')
  .argument('[output]', 'Output path', 'models.json')
  .option('--full', 'Copy the full bundled registry instead of a minimal template', false)
  .action(
    initModelsAction(
      BUNDLED_MODELS_PATH,
      'letmedense text.md --ratio 0.3 --models-file models.json',
    ),
  )

// ============================================================================
// Main command (default)
// ============================================================================

program
  .argument('[input]', 'File path or - for stdin')

  .option('--max-chars <n>', 'Target max character count', (v) =>
    parsePositiveInt(v, '--max-chars'),
  )
  .option('--max-tokens <n>', 'Target max token count', (v) => parsePositiveInt(v, '--max-tokens'))
  .option('--ratio <n>', 'Target compression ratio (0-1)', parseRatio)
  .option('-m, --model <spec>', 'LLM model (e.g., openai:mini)')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('-q, --quiet', 'Suppress progress to stderr', false)
  .option('--chunk-strategy <strategy>', 'Chunking strategy: heading, paragraph, tokens', 'heading')
  .option(
    '--concurrency <n>',
    'Max parallel LLM calls',
    (v) => parsePositiveInt(v, '--concurrency'),
    5,
  )
  .option(
    '--max-depth <n>',
    'Max reduce recursion depth',
    (v) => parsePositiveInt(v, '--max-depth'),
    10,
  )
  .option('--json', 'Output full result as JSON (includes usage/cost)', false)
  .option('--dotenv', 'Load .env file', false)
  .option('--models-file <path>', 'Path to models.json file (default: bundled)')
  .option('--models-json <json>', 'Raw JSON string for model registry (overrides --models-file)')

  .addHelpText(
    'after',
    `
Examples:
  $ letmedense article.md --ratio 0.3
  $ letmedense long.txt --max-tokens 500 -m openai:mini
  $ cat document.md | letmedense - --max-chars 2000
  $ letmedense notes.md --ratio 0.5 --json -o summary.json
`,
  )

  .action(async (input: string | undefined, opts: DenseCliOptions) => {
    if (!input) {
      program.help()
      return
    }

    await cliObsFactory.init()

    const { logger, tracer, metrics } = getObs()
    const startTime = performance.now()

    try {
      await tracer.startSpan(Spans.CONDENSE, async (span) => {
        span.setAttribute('input', input === '-' ? 'stdin' : input)

        // ── Validate target ────────────────────────────────────────────────
        if (opts.maxChars == null && opts.maxTokens == null && opts.ratio == null) {
          console.error('Error: At least one of --max-chars, --max-tokens, or --ratio is required')
          await exitWithCode(EXIT_INPUT_ERROR, metrics, startTime)
          return
        }

        // ── Validate chunk strategy ────────────────────────────────────────
        const validStrategies: ChunkStrategy[] = ['heading', 'paragraph', 'tokens']
        if (!validStrategies.includes(opts.chunkStrategy)) {
          console.error(`Error: --chunk-strategy must be one of: ${validStrategies.join(', ')}`)
          await exitWithCode(EXIT_INPUT_ERROR, metrics, startTime)
          return
        }

        // ── Validate output path ───────────────────────────────────────────
        const outputPath = opts.output === '-' ? undefined : opts.output
        if (outputPath) {
          await validateOutputPath(outputPath)
        }

        // ── Read input ─────────────────────────────────────────────────────
        let text: string
        if (input === '-') {
          log('Reading from stdin...', opts.quiet)
          const buf = await readStdin()
          if (buf.length === 0) {
            console.error('Error: No input received from stdin')
            await exitWithCode(EXIT_INPUT_ERROR, metrics, startTime)
            return
          }
          text = buf.toString('utf-8')
        } else {
          try {
            text = await fs.readFile(input, 'utf-8')
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            if (code === 'ENOENT') {
              console.error(`Error: File not found: ${input}`)
            } else {
              console.error(`Error: Cannot read file: ${(err as Error).message}`)
            }
            await exitWithCode(EXIT_INPUT_ERROR, metrics, startTime)
            return
          }
        }

        if (text.trim().length === 0) {
          console.error('Error: Input is empty')
          await exitWithCode(EXIT_INPUT_ERROR, metrics, startTime)
          return
        }

        span.setAttribute('inputChars', text.length)
        log(`Input: ${text.length} chars`, opts.quiet)

        // ── Build condense options ─────────────────────────────────────────
        const { condense } = await import('../lib/condense/index.js')

        const condenseOpts: CondenseOptions = {
          target: {
            ...(opts.maxChars != null && { maxChars: opts.maxChars }),
            ...(opts.maxTokens != null && { maxTokens: opts.maxTokens }),
            ...(opts.ratio != null && { ratio: opts.ratio }),
          },
          model: opts.model,
          chunkStrategy: opts.chunkStrategy,
          concurrency: opts.concurrency,
          maxRecursionDepth: opts.maxDepth,
          onProgress: opts.quiet ? undefined : formatProgress,
        }

        // ── Run condense ───────────────────────────────────────────────────
        const result = await condense(text, condenseOpts)

        span.setAttribute('outputChars', result.outputChars)
        span.setAttribute('ratio', result.ratio)
        span.setAttribute(SemanticAttributes.MODEL, result.model)

        // ── Output ─────────────────────────────────────────────────────────
        let output: string
        if (opts.json) {
          const { text: _text, ...meta } = result
          output = JSON.stringify({ text: result.text, ...meta }, null, 2)
        } else {
          output = result.text
        }

        const finalOutput = output.endsWith('\n') ? output : `${output}\n`

        if (outputPath) {
          await fs.writeFile(outputPath, finalOutput, 'utf-8')
          log(`Output written to ${outputPath}`, opts.quiet)
        } else {
          process.stdout.write(finalOutput)
        }

        // ── Summary to stderr ──────────────────────────────────────────────
        if (!opts.quiet) {
          const summary = [
            `Ratio: ${(result.ratio * 100).toFixed(1)}%`,
            `${result.inputChars} → ${result.outputChars} chars`,
            `Tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`,
            `Cost: $${result.cost.total.toFixed(4)}`,
            `Model: ${result.provider}:${result.model}`,
          ]
          if (result.passthrough) summary.unshift('(passthrough — input already fits target)')
          console.error(`\n${summary.join(' | ')}`)
        }

        logger.info(
          {
            inputChars: result.inputChars,
            outputChars: result.outputChars,
            ratio: result.ratio,
            model: result.model,
            cost: result.cost.total,
          },
          'Condense completed',
        )

        await exitWithCode(EXIT_SUCCESS, metrics, startTime)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      logger.error({ err, input }, 'Condense failed')
      const exitCode = err instanceof CliError ? err.exitCode : EXIT_PROCESSING_ERROR
      await exitWithCode(exitCode, metrics, startTime)
    }
  })

// ============================================================================
// Progress Formatter
// ============================================================================

function formatProgress(event: CondenseProgressEvent): void {
  switch (event.phase) {
    case 'start':
      console.error(
        event.targetChars != null
          ? `Target: ${event.targetChars} chars`
          : `Target: ${event.targetTokens} tokens`,
      )
      break
    case 'chunk':
      console.error(`Chunked into ${event.chunkCount} pieces (${event.strategy})`)
      break
    case 'map':
      console.error(`  Map ${event.chunkIndex + 1}/${event.totalChunks}...`)
      break
    case 'map-done':
      console.error(`Map done: ${event.summaryTokens} tokens`)
      break
    case 'reduce':
      console.error(`  Reduce pass ${event.depth} (${event.inputTokens} tokens)...`)
      break
    case 'reduce-done':
      console.error(`  Reduce pass ${event.depth} → ${event.outputTokens} tokens`)
      break
    case 'done':
      console.error(`Done: ${(event.ratio * 100).toFixed(1)}% of original`)
      break
  }
}

// ============================================================================
// Parse
// ============================================================================

program.parse()
