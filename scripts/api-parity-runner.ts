#!/usr/bin/env tsx

/**
 * API parity runner - executes extraction using the library API.
 * Accepts CLI-like arguments for comparison testing.
 *
 * Usage: tsx scripts/api-parity-runner.ts <input> [options]
 */

// Suppress logging (equivalent to CLI's -q flag)
process.env.LOG_LEVEL = 'silent'

// Load .env if --dotenv flag is present (check early)
if (process.argv.includes('--dotenv')) {
  await import('dotenv/config')
}

import type { SenseOptions, VisionOptions } from '../lib/sense/api.js'
import { sense, senseStream } from '../lib/sense/api.js'

interface ParsedArgs {
  input: string
  options: SenseOptions
  outputJson: boolean
  useVision: boolean
  useLlm: boolean
}

// Parse CLI-like arguments
function parseArgs(args: string[]): ParsedArgs {
  // Default separator matches CLI default
  const options: SenseOptions = {
    separator: '\n\n===\n\n',
  }
  let input = ''
  let outputJson = false
  let useVision = false
  let useLlm = false
  let model: string | undefined
  let prompt: string | undefined
  let playwright: 'always' | 'auto' | 'none' | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (!arg.startsWith('-') && !input) {
      input = arg
      continue
    }

    switch (arg) {
      case '-j':
      case '--json':
        outputJson = true
        options.includeMetadata = true
        break
      case '--strict':
        options.strict = true
        break
      case '--no-parallel':
        options.parallel = false
        break
      case '--parallel':
        options.parallel = true
        break
      case '--separator':
        options.separator = args[++i]
        break
      case '--ocr-lang':
        options.ocrLanguage = args[++i]
        break
      case '--input-format':
        options.format = args[++i] as SenseOptions['format']
        break
      case '--include-notes':
        options.includeNotes = true
        break
      case '--slides':
        options.slides = args[++i]
        break
      case '--sheets':
        options.sheets = args[++i]
        break
      case '--headers':
        options.headers = true
        break
      case '--max-rows':
        // maxRows is a CLI presentation concern (CSV/TSV), not an extraction option
        break
      case '-d':
      case '--max-dimension':
        options.maxDimension = parseInt(args[++i], 10)
        break
      case '--quality':
        options.quality = parseInt(args[++i], 10)
        break
      // LLM options
      case '--llm':
        useLlm = true
        break
      case '--vision':
        useVision = true
        break
      case '-m':
      case '--model':
        model = args[++i]
        break
      case '-p':
      case '--prompt':
        prompt = args[++i]
        break
      case '--playwright':
        playwright = args[++i] as 'always' | 'auto' | 'none'
        break
      // Skip options not relevant for parity testing
      case '-o':
      case '--output':
      case '-q':
      case '--quiet':
      case '--prompt-file':
      case '-y':
      case '--yes':
      case '--stream':
      case '--no-stream':
      case '-J':
      case '--journal':
      case '--journal-tag':
      case '--journal-dir':
      case '--journal-format':
      case '--dotenv':
      case '--timeout':
      case '--csv':
      case '--tsv':
      case '--ocr':
      case '--metadata-only':
      case '--include-data':
      case '--data-uri':
        // Skip these or consume their arguments
        if (
          [
            '-o',
            '--output',
            '--prompt-file',
            '--journal-tag',
            '--journal-dir',
            '--journal-format',
            '--timeout',
          ].includes(arg)
        ) {
          i++ // Skip the argument value
        }
        break
    }
  }

  // Configure LLM/vision options
  if (useLlm) {
    options.llm = model ? { model, prompt } : { prompt }
  }
  if (useVision) {
    const visionOpts: VisionOptions = {}
    if (model) visionOpts.model = model
    if (prompt) visionOpts.prompt = prompt
    if (playwright) visionOpts.playwright = playwright
    options.vision = Object.keys(visionOpts).length > 0 ? visionOpts : true
  }

  return { input, options, outputJson, useVision, useLlm }
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.error('Usage: tsx scripts/api-parity-runner.ts <input> [options]')
    console.error('Runs extraction using the library API for parity testing.')
    console.error('')
    console.error('Supports: --llm, --vision, --model, --prompt, --playwright')
    process.exit(1)
  }

  const { input, options, outputJson, useVision } = parseArgs(args)

  if (!input) {
    console.error('Error: No input file specified')
    process.exit(1)
  }

  try {
    // Import format plugins
    await import('../lib/formats/pdf/index.js')
    await import('../lib/formats/office/index.js')
    await import('../lib/formats/image/index.js')

    // Vision mode uses streaming
    if (useVision) {
      // Register all providers
      const { registerAllProviders } = await import('../lib/ai/bootstrap.js')
      registerAllProviders()

      const chunks: string[] = []
      for await (const chunk of senseStream(input, {
        ...options,
        vision: options.vision as VisionOptions | true,
      })) {
        if (chunk.type === 'content') {
          chunks.push(chunk.content)
        }
      }

      // Output with trailing newline (matching CLI)
      const output = chunks.join('')
      const finalOutput = output.endsWith('\n') ? output : `${output}\n`
      process.stdout.write(finalOutput)
      process.exit(0)
    }

    // Standard extraction (with optional LLM formatting)
    const result = await sense(input, options)

    if (outputJson) {
      // Output JSON format matching CLI
      const output = {
        text: result.text,
        source: result.source,
        format: result.format,
        unitCount: result.unitCount,
        runCount: result.runCount,
        errors: result.errors,
        metadata: result.metadata,
      }
      console.log(JSON.stringify(output, null, 2))
    } else {
      // Output plain text
      const finalOutput = result.text.endsWith('\n') ? result.text : `${result.text}\n`
      process.stdout.write(finalOutput)
    }

    process.exit(0)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}

main()
