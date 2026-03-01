/**
 * Unit tests for vision.ts
 */

import type { LanguageModel } from 'ai'

// Mock AI SDK before importing vision module
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}))

import { generateText, streamText } from 'ai'
import { analyzeImage, analyzeImageStreaming, createVisionModel } from './vision.js'

// Test model mock
const mockModel = 'test-model' as unknown as LanguageModel
const mockModelWithId = { modelId: 'gpt-5-mini' } as unknown as LanguageModel
const mockGatewayModel = 'openai/gpt-5-mini' as unknown as LanguageModel

// Mock result type helper
type MockGenerateResult = Awaited<ReturnType<typeof generateText>>
type MockStreamResult = ReturnType<typeof streamText>

describe('vision', () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // analyzeImage (non-streaming)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('analyzeImage', () => {
    it('returns description on success', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'A red circle on white background',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as unknown as MockGenerateResult)

      const result = await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModel,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.description).toBe('A red circle on white background')
        expect(result.truncated).toBe(false)
      }
    })

    it('truncates long descriptions', async () => {
      const longText = 'x'.repeat(60000)
      vi.mocked(generateText).mockResolvedValueOnce({
        text: longText,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as unknown as MockGenerateResult)

      const result = await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModel,
        maxOutputChars: 50000,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.description.length).toBe(50000)
        expect(result.truncated).toBe(true)
      }
    })

    it('uses custom prompt when provided', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Custom analysis result',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as unknown as MockGenerateResult)

      await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModel,
        prompt: 'Extract all text from this image',
      })

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract all text from this image' },
                { type: 'image', image: 'data:image/png;base64,base64data' },
              ],
            },
          ],
        }),
      )
    })

    it('returns error when image data is empty', async () => {
      const result = await analyzeImage({
        imageData: '',
        mimeType: 'image/png',
        model: mockModel,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('INVALID_INPUT')
      }
    })

    it('returns TIMEOUT error when request times out', async () => {
      vi.mocked(generateText).mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Vision analysis timed out')), 10),
          ),
      )

      const result = await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModel,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('TIMEOUT')
      }
    })

    it('returns NO_API_KEY error for authentication failures', async () => {
      vi.mocked(generateText).mockRejectedValueOnce(new Error('Invalid API key'))

      const result = await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModel,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('NO_API_KEY')
      }
    })

    it('returns MODEL_ERROR for other errors', async () => {
      vi.mocked(generateText).mockRejectedValueOnce(new Error('Model overloaded'))

      const result = await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModel,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('MODEL_ERROR')
        expect(result.error).toBe('Model overloaded')
      }
    })

    it('handles null text response', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: null,
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 0 },
      } as unknown as MockGenerateResult)

      const result = await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModel,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.description).toBe('')
      }
    })

    it('extracts model ID from string model', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Description',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as unknown as MockGenerateResult)

      const result = await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockGatewayModel,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.model).toBe('openai/gpt-5-mini')
      }
    })

    it('extracts model ID from object model', async () => {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Description',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      } as unknown as MockGenerateResult)

      const result = await analyzeImage({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModelWithId,
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.model).toBe('gpt-5-mini')
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // analyzeImageStreaming
  // ─────────────────────────────────────────────────────────────────────────────

  describe('analyzeImageStreaming', () => {
    it('yields chunks from stream', async () => {
      const mockStream = (async function* () {
        yield 'Hello'
        yield ' '
        yield 'World'
      })()

      vi.mocked(streamText).mockReturnValueOnce({
        textStream: mockStream,
      } as unknown as MockStreamResult)

      const chunks: string[] = []
      for await (const chunk of analyzeImageStreaming({
        imageData: 'base64data',
        mimeType: 'image/png',
        model: mockModel,
      })) {
        chunks.push(chunk)
      }

      expect(chunks).toEqual(['Hello', ' ', 'World'])
    })

    it('uses custom prompt when provided', async () => {
      const mockStream = (async function* () {
        yield 'Result'
      })()

      vi.mocked(streamText).mockReturnValueOnce({
        textStream: mockStream,
      } as unknown as MockStreamResult)

      // Consume the generator
      for await (const _ of analyzeImageStreaming({
        imageData: 'base64data',
        mimeType: 'image/jpeg',
        model: mockModel,
        prompt: 'Custom prompt',
      })) {
        // just iterate
      }

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Custom prompt' },
                { type: 'image', image: 'data:image/jpeg;base64,base64data' },
              ],
            },
          ],
        }),
      )
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // createVisionModel
  // ─────────────────────────────────────────────────────────────────────────────

  describe('createVisionModel', () => {
    const originalEnv = process.env

    beforeEach(() => {
      process.env = { ...originalEnv }
    })

    afterEach(() => {
      process.env = originalEnv
    })

    it('returns error for invalid format', () => {
      const result = createVisionModel('invalid')
      expect(result.error).toContain('Invalid model format')
      expect(result.model).toBeNull()
    })

    it('returns error for unknown provider', () => {
      const result = createVisionModel('unknown:model')
      expect(result.error).toContain('Unknown provider')
      expect(result.model).toBeNull()
    })

    it('returns error when API key is missing', () => {
      delete process.env.OPENAI_API_KEY
      const result = createVisionModel('openai:gpt-5-mini')
      expect(result.error).toContain('Missing API key')
      expect(result.error).toContain('OPENAI_API_KEY')
      expect(result.model).toBeNull()
    })

    it('returns error when Anthropic API key is missing', () => {
      delete process.env.ANTHROPIC_API_KEY
      const result = createVisionModel('anthropic:sonnet')
      expect(result.error).toContain('ANTHROPIC_API_KEY')
      expect(result.model).toBeNull()
    })

    it('returns error when Google API key is missing', () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
      const result = createVisionModel('google:flash')
      expect(result.error).toContain('GOOGLE_GENERATIVE_AI_API_KEY')
      expect(result.model).toBeNull()
    })

    it('creates model when API key is present', () => {
      process.env.OPENAI_API_KEY = 'test-key'
      const result = createVisionModel('openai:gpt-5-mini')
      expect(result.error).toBeUndefined()
      expect(result.model).toBeDefined()
    })

    it('resolves model aliases', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key'
      const result = createVisionModel('anthropic:sonnet')
      expect(result.error).toBeUndefined()
      expect(result.model).toBeDefined()
    })

    it('ollama provider does not require API key', () => {
      const result = createVisionModel('ollama:llava')
      expect(result.error).toBeUndefined()
      expect(result.model).toBeDefined()
    })
  })
})
