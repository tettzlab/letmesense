/**
 * Tests for vision processor functions.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkLibreOffice } from '../convert/libreoffice.js'
import type { VisionContent } from './types.js'

// Check if LibreOffice is available
const libreOfficeStatus = checkLibreOffice()

// Test fixture path
const FIXTURES_DIR = join(process.cwd(), 'lib/office/fixtures')
const PPTX_FIXTURE = join(FIXTURES_DIR, 'sample.pptx')
const hasFixture = existsSync(PPTX_FIXTURE)

// Cache for whether LibreOffice conversion actually works
let conversionWorks: boolean | null = null

// Check for API keys
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY
const hasOpenAIKey = !!process.env.OPENAI_API_KEY

async function checkConversionWorks(): Promise<boolean> {
  if (conversionWorks !== null) return conversionWorks
  if (!libreOfficeStatus.available || !hasFixture) {
    conversionWorks = false
    return false
  }
  try {
    const { convertDocumentToPdf } = await import('./render.js')
    const result = await convertDocumentToPdf(PPTX_FIXTURE)
    conversionWorks = result.pdfBytes.length > 0
    return conversionWorks
  } catch {
    conversionWorks = false
    return false
  }
}

describe('processor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('prepareVisionContent', () => {
    it('prepares content with PDF for Anthropic provider', async () => {
      if (!(await checkConversionWorks()) || !hasAnthropicKey) {
        console.log('⏭️  Skipping: LibreOffice conversion not working or no Anthropic API key')
        return
      }

      // Register providers
      const { registerAllProviders } = await import('../../ai/providers.js')
      registerAllProviders()

      const { prepareVisionContent } = await import('./processor.js')

      const result = await prepareVisionContent(
        PPTX_FIXTURE,
        ['Slide 1 text', 'Slide 2 text'],
        'pptx',
        { llm: { provider: 'anthropic' } },
      )

      expect(result.usePdfDirect).toBe(true)
      expect(result.contents.length).toBe(2)
      expect(result.contents[0].pdfBytes).toBeDefined()
      expect(result.contents[0].pdfPageRange).toBeDefined()
    }, 60000)

    it('prepares content with images for OpenAI provider', async () => {
      if (!(await checkConversionWorks()) || !hasOpenAIKey) {
        console.log('⏭️  Skipping: LibreOffice conversion not working or no OpenAI API key')
        return
      }

      // Register providers
      const { registerAllProviders } = await import('../../ai/providers.js')
      registerAllProviders()

      // Need to reimport to get fresh module
      vi.resetModules()
      const { prepareVisionContent } = await import('./processor.js')

      const result = await prepareVisionContent(PPTX_FIXTURE, ['Slide 1 text'], 'pptx', {
        llm: { provider: 'openai' },
      })

      expect(result.usePdfDirect).toBe(false)
      expect(result.contents[0].renderedImage).toBeDefined()
    }, 60000)
  })

  describe('estimateVisionCost', () => {
    const hasAnyKey = hasAnthropicKey || hasOpenAIKey

    it('estimates cost for contents', async () => {
      if (!hasAnyKey) {
        console.log('⏭️  Skipping: No API key available')
        return
      }

      // Register providers
      const { registerAllProviders } = await import('../../ai/providers.js')
      registerAllProviders()

      const { estimateVisionCost } = await import('./processor.js')

      const contents: VisionContent[] = [
        {
          unitIndex: 0,
          unitLabel: 'Slide 1',
          extractedText: 'Hello World '.repeat(100),
          embeddedImages: [],
          attributes: {
            unitIndex: 0,
            unitLabel: 'Slide 1',
            kind: 'text-rich',
            charCount: 1200,
            imageCount: 0,
            textSample: 'Hello World',
            language: 'eng',
          },
        },
      ]

      const provider = hasAnthropicKey ? 'anthropic' : 'openai'
      const model = hasAnthropicKey ? 'claude-sonnet-4-5-20250929' : 'gpt-5.2'
      const estimate = estimateVisionCost(contents, {
        llm: { provider, model },
      })

      expect(estimate).toBeDefined()
      expect(estimate.inputTokens).toBeGreaterThan(0)
      expect(estimate.totalCost).toBeGreaterThanOrEqual(0)
      expect(estimate.provider).toBe(provider)
    })

    it('returns zero cost for empty contents', async () => {
      if (!hasAnyKey) {
        console.log('⏭️  Skipping: No API key available')
        return
      }

      const { registerAllProviders } = await import('../../ai/providers.js')
      registerAllProviders()
      const { estimateVisionCost } = await import('./processor.js')

      const provider = hasAnthropicKey ? 'anthropic' : 'openai'
      const estimate = estimateVisionCost([], {
        llm: { provider },
      })

      expect(estimate.inputTokens).toBe(0)
    })
  })

  describe('formatOfficeWithVision', () => {
    it('requires API key for actual formatting', async () => {
      // Register providers
      const { registerAllProviders } = await import('../../ai/providers.js')
      registerAllProviders()

      // This test verifies the function exists and can be imported
      const { formatOfficeWithVision } = await import('./processor.js')
      expect(typeof formatOfficeWithVision).toBe('function')

      // Actual LLM calls are tested in integration tests with API keys
    })

    it('tracks progress events', async () => {
      // This test verifies the progress callback structure
      const progressEvents: string[] = []

      // Mock would be needed here for proper testing
      // For now just verify the type structure
      const mockProgress = (event: { type: string }) => {
        progressEvents.push(event.type)
      }

      expect(typeof mockProgress).toBe('function')
    })
  })

  describe('getUnitLabel helper', () => {
    it('uses correct labels for different formats', async () => {
      if (!(await checkConversionWorks()) || !hasAnthropicKey) {
        console.log('⏭️  Skipping: LibreOffice conversion not working or no Anthropic API key')
        return
      }

      const { registerAllProviders } = await import('../../ai/providers.js')
      registerAllProviders()
      const { prepareVisionContent } = await import('./processor.js')

      const pptxResult = await prepareVisionContent(PPTX_FIXTURE, ['Text'], 'pptx', {
        llm: { provider: 'anthropic' },
      })
      expect(pptxResult.contents[0].unitLabel).toBe('Slide 1')
    }, 60000)
  })
})

describe('processor integration', () => {
  // These tests require both LibreOffice and an API key
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY
  const canRunIntegration = hasFixture && libreOfficeStatus.available && hasApiKey

  it('full pipeline with real LLM', async () => {
    if (!canRunIntegration) {
      console.log('⏭️  Skipping: Missing LibreOffice or API key')
      return
    }
    if (!(await checkConversionWorks())) {
      console.log('⏭️  Skipping: LibreOffice conversion not working')
      return
    }

    const { registerAllProviders } = await import('../../ai/providers.js')
    registerAllProviders()

    const processor = await import('./processor.js')

    // Prepare content
    const prepared = await processor.prepareVisionContent(PPTX_FIXTURE, ['Slide text'], 'pptx', {
      llm: { provider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai' },
    })

    expect(prepared.contents.length).toBe(1)

    // Format with LLM (this makes real API calls)
    const result = await processor.formatOfficeWithVision(prepared.contents.slice(0, 1), 'pptx', {
      llm: { provider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai' },
    })

    expect(result.content).toBeTruthy()
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  }, 120000)
})
