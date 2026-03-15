#!/usr/bin/env tsx
/**
 * In-process parallel sense() runner.
 *
 * Spawns multiple sense-worker.ts subprocesses concurrently.
 * Designed to be launched multiple times by test-parallel-sense.sh for
 * layered inter-process + intra-process parallelism.
 *
 * Usage:
 *   tsx scripts/parallel-sense.ts [options] <files...>
 *
 * Options:
 *   -c, --concurrency N   Max concurrent workers (default: 4)
 *   -r, --repeat N        Repeat each file N times (default: 1)
 *   -t, --timeout SECS    Per-file timeout in seconds (default: 120)
 *   --vision              Enable vision mode
 *   --model SPEC          Model spec for vision (e.g. openai:gpt-4o)
 *   --format FMT          Force format (pdf, pptx, etc.)
 *   --worker PATH         Path to sense-worker.ts (default: scripts/sense-worker.ts)
 *   -e, --env-file PATH   Load env file (default: .env if it exists)
 *   --no-env              Skip auto-loading .env
 *   -v, --verbose         Print per-file results as they complete
 *   -q, --quiet           Only print final summary JSON
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WorkerResult {
  file: string
  ok: boolean
  chars: number
  units: number
  durationMs: number
  error: string
  pid: number
}

interface Summary {
  processId: number
  totalFiles: number
  succeeded: number
  failed: number
  totalChars: number
  totalUnits: number
  wallTimeMs: number
  avgDurationMs: number
  results: WorkerResult[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Semaphore (simple async concurrency limiter)
// ─────────────────────────────────────────────────────────────────────────────

class Semaphore {
  private current = 0
  private queue: (() => void)[] = []

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    this.current--
    const next = this.queue.shift()
    if (next) {
      this.current++
      next()
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker runner
// ─────────────────────────────────────────────────────────────────────────────

async function runWorker(
  file: string,
  semaphore: Semaphore,
  workerPath: string,
  opts: {
    cwd: string
    timeout: number
    vision: boolean
    model?: string
    format?: string
    verbose: boolean
  },
): Promise<WorkerResult> {
  await semaphore.acquire()

  return new Promise((res) => {
    const args = [workerPath, file]
    if (opts.vision) args.push('--vision')
    if (opts.model) args.push('--model', opts.model)
    if (opts.format) args.push('--format', opts.format)

    const env = { ...process.env, LOG_LEVEL: 'silent' }

    const proc = spawn('npx', ['tsx', ...args], {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: WorkerResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      semaphore.release()

      if (opts.verbose) {
        const status = result.ok ? 'OK' : 'FAIL'
        const detail = result.ok ? `${result.chars} chars` : result.error.slice(0, 80)
        process.stderr.write(
          `  [${status}] ${file} — ${detail} (${result.durationMs}ms, pid=${result.pid})\n`,
        )
      }

      res(result)
    }

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      finish({
        file,
        ok: false,
        chars: 0,
        units: 0,
        durationMs: opts.timeout * 1000,
        error: `Timed out after ${opts.timeout}s`,
        pid: proc.pid ?? 0,
      })
      if (opts.verbose) {
        process.stderr.write(`  TIMEOUT ${file} (${opts.timeout}s)\n`)
      }
    }, opts.timeout * 1000)

    proc.stdout.on('data', (d) => {
      stdout += d
    })
    proc.stderr.on('data', (d) => {
      stderr += d
    })

    proc.on('close', () => {
      const text = stdout.trim()
      if (text) {
        try {
          const data = JSON.parse(text)
          finish({
            file: data.file ?? file,
            ok: data.ok ?? false,
            chars: data.chars ?? 0,
            units: data.units ?? 0,
            durationMs: data.durationMs ?? 0,
            error: data.error ?? '',
            pid: data.pid ?? 0,
          })
        } catch {
          finish({
            file,
            ok: false,
            chars: 0,
            units: 0,
            durationMs: 0,
            error: `Invalid JSON output: ${text.slice(0, 200)}`,
            pid: 0,
          })
        }
      } else {
        finish({
          file,
          ok: false,
          chars: 0,
          units: 0,
          durationMs: 0,
          error: stderr.trim().slice(0, 500) || `No output, exit code ${proc.exitCode}`,
          pid: 0,
        })
      }
    })

    proc.on('error', (err) => {
      finish({
        file,
        ok: false,
        chars: 0,
        units: 0,
        durationMs: 0,
        error: err.message,
        pid: 0,
      })
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    concurrency: { type: 'string', short: 'c', default: '4' },
    repeat: { type: 'string', short: 'r', default: '1' },
    timeout: { type: 'string', short: 't', default: '120' },
    vision: { type: 'boolean', default: false },
    model: { type: 'string' },
    format: { type: 'string' },
    worker: { type: 'string', default: 'scripts/sense-worker.ts' },
    'env-file': { type: 'string', short: 'e' },
    'no-env': { type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    quiet: { type: 'boolean', short: 'q', default: false },
  },
})

// Resolve project root (needed for .env resolution)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const cwd = resolve(scriptDir, '..')

// Load .env file
const envFile = values['env-file']
const noEnv = values['no-env'] ?? false

if (envFile) {
  if (!existsSync(envFile)) {
    process.stderr.write(`Error: Env file not found: ${envFile}\n`)
    process.exit(1)
  }
  process.loadEnvFile(envFile)
} else if (!noEnv) {
  const defaultEnv = resolve(cwd, '.env')
  if (existsSync(defaultEnv)) {
    process.loadEnvFile(defaultEnv)
  }
}

const concurrency = Number(values.concurrency)
const repeat = Number(values.repeat)
const timeout = Number(values.timeout)
const files = positionals

if (files.length === 0) {
  process.stderr.write('Usage: tsx scripts/parallel-sense.ts [options] <files...>\n')
  process.exit(2)
}

// Expand file list with repeats
const allFiles: string[] = []
for (const f of files) {
  for (let i = 0; i < repeat; i++) {
    allFiles.push(f)
  }
}

const quiet = values.quiet ?? false

if (!quiet) {
  process.stderr.write(
    `[Process ${process.pid}] Processing ${allFiles.length} tasks ` +
      `(concurrency=${concurrency}, repeat=${repeat})\n`,
  )
}

const semaphore = new Semaphore(concurrency)
const wallStart = performance.now()

// Launch all workers (semaphore gates actual execution)
const workerPath = values.worker ?? 'scripts/sense-worker.ts'
const vision = values.vision ?? false
const verbose = values.verbose ?? false

const tasks = allFiles.map((f) =>
  runWorker(f, semaphore, workerPath, {
    cwd,
    timeout,
    vision,
    model: values.model,
    format: values.format,
    verbose,
  }),
)

const results = await Promise.all(tasks)

const wallMs = Math.round(performance.now() - wallStart)

// Build summary
const summary: Summary = {
  processId: process.pid,
  totalFiles: results.length,
  succeeded: 0,
  failed: 0,
  totalChars: 0,
  totalUnits: 0,
  wallTimeMs: wallMs,
  avgDurationMs: 0,
  results: [],
}

let totalDuration = 0
for (const r of results) {
  if (r.ok) {
    summary.succeeded++
    summary.totalChars += r.chars
    summary.totalUnits += r.units
  } else {
    summary.failed++
  }
  totalDuration += r.durationMs
  summary.results.push(r)
}

summary.avgDurationMs =
  results.length > 0 ? Math.round((totalDuration / results.length) * 10) / 10 : 0

if (!quiet) {
  process.stderr.write(
    `[Process ${process.pid}] Done: ${summary.succeeded}/${summary.totalFiles} succeeded, ` +
      `${summary.failed} failed, wall=${wallMs}ms, avg=${summary.avgDurationMs}ms\n`,
  )
}

// Machine-readable summary to stdout
console.log(JSON.stringify(summary))

process.exit(summary.failed > 0 ? 1 : 0)
