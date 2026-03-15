#!/usr/bin/env tsx
/**
 * LLM-based semantic comparison for parity testing.
 * Compares two outputs and determines if they are semantically equivalent
 * despite minor differences due to LLM non-determinism.
 *
 * Usage: tsx scripts/llm-compare.ts <cli-output-file> <api-output-file>
 *
 * Exit codes:
 *   0 - Semantically equivalent
 *   1 - Semantically different
 *   2 - Error during comparison
 */

// Load .env
await import('dotenv/config')

import fs from 'node:fs/promises'
import { generateText } from 'ai'
import { registerAllProviders } from '../lib/ai/bootstrap.js'
import { createModel } from '../lib/ai/createModel.js'
import { detectProvider, resolveProvider } from '../lib/ai/provider.js'

// Register all providers
registerAllProviders()

const COMPARE_PROMPT = `You are comparing two document extraction outputs: one from a CLI tool and one from a library API.
Both tools should produce semantically equivalent results, but minor differences are acceptable due to LLM non-determinism.

Acceptable differences:
- Minor wording variations (synonyms, rephrasing)
- Whitespace and formatting differences
- Slight differences in markdown syntax (e.g., ** vs __)
- Minor punctuation differences
- Order of equivalent information within the same section

Unacceptable differences:
- Missing content or sections
- Factually different information
- Significantly different structure
- One output is an error while the other is valid content
- Major omissions or additions

CLI Output:
---
{cli}
---

API Output:
---
{api}
---

Analyze both outputs and respond with a JSON object:
{
  "equivalent": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "differences": ["list of notable differences if any"]
}

Respond ONLY with the JSON object, no other text.`

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('Usage: tsx scripts/llm-compare.ts <cli-output> <api-output>')
    process.exit(2)
  }

  const [cliFile, apiFile] = args

  try {
    // Read files
    const cliOutput = await fs.readFile(cliFile, 'utf-8')
    const apiOutput = await fs.readFile(apiFile, 'utf-8')

    // Quick check: if outputs are identical, no need for LLM
    if (cliOutput === apiOutput) {
      console.log(
        JSON.stringify(
          {
            equivalent: true,
            confidence: 1.0,
            reason: 'Outputs are identical',
            differences: [],
          },
          null,
          2,
        ),
      )
      process.exit(0)
    }

    // Check if both are errors
    const cliIsError = cliOutput.startsWith('Error:')
    const apiIsError = apiOutput.startsWith('Error:')
    if (cliIsError && apiIsError) {
      // Both failed - check if same error type
      const cliErrorType = cliOutput.split('\n')[0]
      const apiErrorType = apiOutput.split('\n')[0]
      const sameError = cliErrorType === apiErrorType
      console.log(
        JSON.stringify(
          {
            equivalent: sameError,
            confidence: sameError ? 1.0 : 0.8,
            reason: sameError ? 'Both failed with same error' : 'Both failed but different errors',
            differences: sameError ? [] : [cliErrorType, apiErrorType],
          },
          null,
          2,
        ),
      )
      process.exit(sameError ? 0 : 1)
    }

    // One error, one success = not equivalent
    if (cliIsError !== apiIsError) {
      console.log(
        JSON.stringify(
          {
            equivalent: false,
            confidence: 1.0,
            reason: `CLI ${cliIsError ? 'failed' : 'succeeded'}, API ${apiIsError ? 'failed' : 'succeeded'}`,
            differences: ['One succeeded while the other failed'],
          },
          null,
          2,
        ),
      )
      process.exit(1)
    }

    // Detect provider and create model
    const detected = detectProvider()
    if (!detected) {
      console.error('Error: No LLM provider available for comparison')
      console.error('Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY')
      process.exit(2)
    }

    const provider = resolveProvider({ provider: detected.provider })
    const modelSpec = { provider: detected.provider, modelId: provider.defaultModel, effort: null }
    const model = createModel(modelSpec)

    // Prepare prompt
    const prompt = COMPARE_PROMPT.replace('{cli}', truncate(cliOutput, 4000)).replace(
      '{api}',
      truncate(apiOutput, 4000),
    )

    // Call LLM
    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 500,
    })

    // Parse response
    const result = JSON.parse(text.trim())

    console.log(JSON.stringify(result, null, 2))
    process.exit(result.equivalent ? 0 : 1)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}\n... (truncated, ${text.length - maxLen} more chars)`
}

main()
