/**
 * Shared utilities for CLI entry points (letmesense, letmedense).
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ============================================================================
// Bundled Models Path
// ============================================================================

export function getBundledModelsPath(importMetaUrl: string): string {
  return new URL('../models.json', importMetaUrl).pathname
}

// ============================================================================
// Exit Codes
// ============================================================================

export const EXIT_SUCCESS = 0
export const EXIT_INPUT_ERROR = 1
export const EXIT_PROCESSING_ERROR = 2

// ============================================================================
// CliError
// ============================================================================

/** Error with an associated CLI exit code, used by helpers to signal early exit. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function log(message: string, quiet: boolean): void {
  if (!quiet) {
    console.error(message)
  }
}

export const STDIN_MAX_BYTES = 500 * 1024 * 1024 // 500 MB

export async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of process.stdin) {
    const buf = chunk as Buffer
    totalBytes += buf.length
    if (totalBytes > STDIN_MAX_BYTES) {
      throw new CliError('stdin input exceeds 500 MB limit', EXIT_INPUT_ERROR)
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

export async function validateOutputPath(outputPath: string): Promise<void> {
  try {
    const outputStat = await fs.stat(outputPath)
    if (outputStat.isDirectory()) {
      throw new CliError(`Output path '${outputPath}' is a directory`, EXIT_INPUT_ERROR)
    }
  } catch (err) {
    if (err instanceof CliError) throw err
    // File doesn't exist yet
  }

  const parentDir = path.dirname(outputPath)
  try {
    const stat = await fs.stat(parentDir)
    if (!stat.isDirectory()) {
      throw new CliError(`Output path parent '${parentDir}' is not a directory`, EXIT_INPUT_ERROR)
    }
  } catch (err) {
    if (err instanceof CliError) throw err
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`Output directory '${parentDir}' does not exist`, EXIT_INPUT_ERROR)
    }
    throw err
  }
}

// ============================================================================
// Model template
// ============================================================================

/** Minimal models.json template with one model per provider. */
const MODELS_TEMPLATE = {
  defaultProvider: 'openai',
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      defaultModel: 'gpt-5-mini',
      defaultVisionModel: 'gpt-5-mini',
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      defaultModel: 'claude-haiku-4-5',
      defaultVisionModel: 'claude-haiku-4-5',
    },
  ],
  models: [
    {
      id: 'gpt-5-mini',
      name: 'GPT-5 Mini',
      provider: 'openai',
      contextWindow: 400000,
      maxOutputTokens: 128000,
      encoding: 'o200k_base',
      aliases: ['mini'],
      pricing: { input: 0.25, output: 2.0, image: 0.25 },
      capabilities: { vision: true },
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      provider: 'anthropic',
      contextWindow: 200000,
      maxOutputTokens: 64000,
      encoding: 'claude',
      aliases: ['haiku'],
      pricing: { input: 1.0, output: 5.0, image: 1.0 },
      capabilities: { vision: true, pdfInput: true },
    },
  ],
}

/**
 * Write a models.json template to disk.
 *
 * @param outputPath - Resolved output path.
 * @param bundledModelsPath - Path to the bundled models.json (for --full).
 * @param full - If true, copy the full bundled registry instead of the minimal template.
 */
async function writeModelsTemplate(
  outputPath: string,
  bundledModelsPath: string,
  full: boolean,
): Promise<void> {
  let content: string
  if (full) {
    try {
      content = await fs.readFile(bundledModelsPath, 'utf-8')
    } catch {
      throw new CliError('Bundled models.json not found', EXIT_INPUT_ERROR)
    }
  } else {
    content = `${JSON.stringify(MODELS_TEMPLATE, null, 2)}\n`
  }

  try {
    await fs.writeFile(outputPath, content, { encoding: 'utf-8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError(
        `${path.basename(outputPath)} already exists. Choose a different path.`,
        EXIT_INPUT_ERROR,
      )
    }
    throw err
  }
}

/**
 * Create the action handler for the `init-models` subcommand.
 */
export function initModelsAction(
  bundledModelsPath: string,
  usageExample: string,
): (output: string, opts: { full: boolean }) => Promise<void> {
  return async (output: string, opts: { full: boolean }) => {
    const outputPath = path.resolve(output)
    await writeModelsTemplate(outputPath, bundledModelsPath, opts.full)
    console.error(`Created ${output}`)
    console.error(`Use it with: ${usageExample}`)
    process.exit(EXIT_SUCCESS)
  }
}

// ============================================================================
// Version
// ============================================================================

/**
 * Read the package version from package.json relative to the given importMetaUrl.
 * Falls back to '0.0.0' if the file cannot be read.
 */
export async function readVersion(importMetaUrl: string): Promise<string> {
  const __dirname = path.dirname(fileURLToPath(importMetaUrl))
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf-8'),
    )
    return packageJson.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
