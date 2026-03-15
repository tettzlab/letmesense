#!/usr/bin/env tsx
/**
 * Minimal sense() wrapper for parallel stress-testing.
 *
 * Usage:
 *   tsx scripts/sense-worker.ts <file> [--vision] [--format <fmt>]
 *
 * Outputs JSON to stdout:
 *   { ok: true, file, chars, units, durationMs }
 *   { ok: false, file, error, durationMs }
 */

import { parseArgs } from 'node:util'

// Suppress pino logging to keep stdout clean for JSON output
process.env.LOG_LEVEL = 'silent'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    vision: { type: 'boolean', default: false },
    format: { type: 'string' },
    model: { type: 'string' },
  },
})

const file = positionals[0]
if (!file) {
  console.error(
    'Usage: tsx scripts/sense-worker.ts <file> [--vision] [--format <fmt>] [--model <spec>]',
  )
  process.exit(2)
}

const start = performance.now()

try {
  // Dynamic import to avoid top-level side effects until ready
  const { sense } = await import('../lib/sense/api.js')

  const result = await sense(file, {
    vision: values.vision ? (values.model ? { model: values.model } : true) : undefined,
    format: values.format as import('../lib/pipeline/types.js').FormatId | undefined,
  })

  const durationMs = Math.round(performance.now() - start)
  console.log(
    JSON.stringify({
      ok: true,
      file,
      chars: result.text.length,
      units: result.unitCount,
      runs: result.runCount,
      errors: result.errors.length,
      durationMs,
      pid: process.pid,
    }),
  )
} catch (err) {
  const durationMs = Math.round(performance.now() - start)
  console.log(
    JSON.stringify({
      ok: false,
      file,
      error: err instanceof Error ? err.message : String(err),
      durationMs,
      pid: process.pid,
    }),
  )
  process.exit(1)
}
