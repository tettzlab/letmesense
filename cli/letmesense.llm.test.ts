/**
 * Integration tests for LLM formatting mode.
 * These tests verify that large documents are processed correctly
 * without truncation when using --llm mode.
 *
 * Note: These tests require an API key to run.
 * Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY to enable.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Check for available API keys
const hasOpenAiKey = !!process.env.OPENAI_API_KEY
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY
const hasGoogleKey = !!process.env.GOOGLE_API_KEY
const hasAnyApiKey = hasOpenAiKey || hasAnthropicKey || hasGoogleKey

// Determine which provider to use
function getProviderConfig(): { provider: string; model: string } | null {
  if (hasOpenAiKey) return { provider: 'openai', model: 'openai:gpt-5-nano' }
  if (hasAnthropicKey) return { provider: 'anthropic', model: 'anthropic:haiku' }
  if (hasGoogleKey) return { provider: 'google', model: 'google:flash' }
  return null
}

const providerConfig = getProviderConfig()
const itWithApi = hasAnyApiKey ? it : it.skip

// Create synthetic test documents
let tempDir: string
let smallPdf: string
let mediumPdf: string
let largePdf: string

/**
 * Generate a simple text file for testing.
 * We use text files since they're easier to generate programmatically.
 */
function generateTextFile(filePath: string, pageCount: number, charsPerPage: number): void {
  const pages: string[] = []
  for (let i = 0; i < pageCount; i++) {
    const pageContent = `Page ${i + 1}\n\n${'Lorem ipsum dolor sit amet. '.repeat(Math.ceil(charsPerPage / 30))}`
    pages.push(pageContent.slice(0, charsPerPage))
  }
  fs.writeFileSync(filePath, pages.join('\n\n---\n\n'), 'utf-8')
}

describe('LLM formatting integration', () => {
  beforeAll(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letmesense-llm-test-'))

    // Generate test files of various sizes
    smallPdf = path.join(tempDir, 'small.txt')
    mediumPdf = path.join(tempDir, 'medium.txt')
    largePdf = path.join(tempDir, 'large.txt')

    generateTextFile(smallPdf, 2, 1000) // ~2KB
    generateTextFile(mediumPdf, 10, 1500) // ~15KB
    generateTextFile(largePdf, 25, 1500) // ~37KB
  })

  afterAll(() => {
    // Cleanup temp files
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('handles various document sizes', () => {
    itWithApi(
      'small document (< 5KB)',
      async () => {
        const outputPath = path.join(tempDir, 'small-output.md')
        execSync(
          `pnpm cli "${smallPdf}" --llm -y --model ${providerConfig?.model} -o "${outputPath}"`,
          {
            encoding: 'utf-8',
            timeout: 60000,
          },
        )

        const result = fs.readFileSync(outputPath, 'utf-8')
        expect(result.length).toBeGreaterThan(500)
        // Should end properly (not mid-sentence)
        expect(result.trim()).toMatch(/[.!?。]\s*$|```\s*$|\n$/)
      },
      60000,
    )

    itWithApi(
      'medium document (5-20KB)',
      async () => {
        const outputPath = path.join(tempDir, 'medium-output.md')
        execSync(
          `pnpm cli "${mediumPdf}" --llm -y --model ${providerConfig?.model} -o "${outputPath}"`,
          {
            encoding: 'utf-8',
            timeout: 120000,
          },
        )

        const result = fs.readFileSync(outputPath, 'utf-8')
        // Medium doc should produce substantial output
        expect(result.length).toBeGreaterThan(3000)
      },
      120000,
    )

    itWithApi(
      'large document (20KB+)',
      async () => {
        const outputPath = path.join(tempDir, 'large-output.md')
        execSync(
          `pnpm cli "${largePdf}" --llm -y --model ${providerConfig?.model} -o "${outputPath}"`,
          {
            encoding: 'utf-8',
            timeout: 180000,
          },
        )

        const result = fs.readFileSync(outputPath, 'utf-8')
        // Large doc should produce substantial output (not truncated to ~700 bytes)
        expect(result.length).toBeGreaterThan(10000)
      },
      180000,
    )
  })

  describe('output quality', () => {
    itWithApi(
      'output ends with complete content (not truncated)',
      async () => {
        const outputPath = path.join(tempDir, 'quality-output.md')
        execSync(
          `pnpm cli "${mediumPdf}" --llm -y --model ${providerConfig?.model} -o "${outputPath}"`,
          {
            encoding: 'utf-8',
            timeout: 120000,
          },
        )

        const result = fs.readFileSync(outputPath, 'utf-8')

        // Check that output doesn't end mid-word (sign of truncation)
        const lastLine = result.trim().split('\n').pop() ?? ''
        // Should not end with incomplete word or abrupt cutoff
        expect(lastLine).not.toMatch(/\w{10,}$/) // Long word at end suggests truncation
        expect(result).not.toMatch(/\.\.\.$/) // Ellipsis at end suggests truncation
      },
      120000,
    )

    itWithApi(
      'maintains page separators in output',
      async () => {
        const outputPath = path.join(tempDir, 'separator-output.md')
        execSync(
          `pnpm cli "${mediumPdf}" --llm -y --model ${providerConfig?.model} -o "${outputPath}"`,
          {
            encoding: 'utf-8',
            timeout: 120000,
          },
        )

        const result = fs.readFileSync(outputPath, 'utf-8')

        // Multi-page docs should have some form of separation
        // (could be ---, or headers, etc. depending on LLM output)
        const hasPageBreaks =
          result.includes('---') || result.includes('Page ') || result.includes('# ')
        expect(hasPageBreaks).toBe(true)
      },
      120000,
    )
  })

  describe('baseline extraction', () => {
    it('extracts text without LLM mode', () => {
      // Use a sample PDF from the repo for more reliable testing
      const samplePdf = path.join(process.cwd(), 'samples', 'born-digital.pdf')

      // Skip if sample file doesn't exist
      if (!fs.existsSync(samplePdf)) {
        console.log('Skipping test - sample PDF not found')
        return
      }

      const result = execSync(`pnpm cli "${samplePdf}"`, {
        encoding: 'utf-8',
        timeout: 120000,
      })

      expect(result.length).toBeGreaterThan(100)
    }, 120000)
  })
})

describe('extractUnits parallel processing', () => {
  it('extracts units correctly from PDF file', () => {
    // Use one of the sample PDFs that exists in the repo
    const samplePdf = path.join(process.cwd(), 'samples', 'born-digital.pdf')

    // Skip if sample file doesn't exist
    if (!fs.existsSync(samplePdf)) {
      console.log('Skipping test - sample PDF not found')
      return
    }

    const result = execSync(`pnpm cli "${samplePdf}" --json`, {
      encoding: 'utf-8',
      timeout: 120000,
    })

    // Extract JSON from output (skip pnpm header lines)
    const jsonStart = result.indexOf('{')
    const jsonStr = result.slice(jsonStart)

    const parsed = JSON.parse(jsonStr)
    expect(parsed.text).toBeDefined()
    expect(parsed.unitCount).toBeGreaterThan(0)
  }, 120000)
})
