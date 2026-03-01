/**
 * Tests for vision prompt builders.
 */

import {
  buildBatchMessages,
  buildUserMessage,
  DEFAULT_SYSTEM_PROMPT,
  DOCX_SYSTEM_PROMPT,
  extractEmbeddedImages,
  getSystemPromptForFormat,
  PPTX_SYSTEM_PROMPT,
  XLSX_SYSTEM_PROMPT,
} from './prompt.js'
import type { VisionContent } from './types.js'

describe('prompt', () => {
  describe('getSystemPromptForFormat', () => {
    it('returns PPTX prompt for pptx format', () => {
      expect(getSystemPromptForFormat('pptx')).toBe(PPTX_SYSTEM_PROMPT)
    })

    it('returns PPTX prompt for odp format', () => {
      expect(getSystemPromptForFormat('odp')).toBe(PPTX_SYSTEM_PROMPT)
    })

    it('returns XLSX prompt for xlsx format', () => {
      expect(getSystemPromptForFormat('xlsx')).toBe(XLSX_SYSTEM_PROMPT)
    })

    it('returns XLSX prompt for ods format', () => {
      expect(getSystemPromptForFormat('ods')).toBe(XLSX_SYSTEM_PROMPT)
    })

    it('returns DOCX prompt for docx format', () => {
      expect(getSystemPromptForFormat('docx')).toBe(DOCX_SYSTEM_PROMPT)
    })

    it('returns DOCX prompt for odt format', () => {
      expect(getSystemPromptForFormat('odt')).toBe(DOCX_SYSTEM_PROMPT)
    })

    it('returns default prompt for unknown format', () => {
      expect(getSystemPromptForFormat('pdf')).toBe(DEFAULT_SYSTEM_PROMPT)
      expect(getSystemPromptForFormat('unknown')).toBe(DEFAULT_SYSTEM_PROMPT)
    })

    it('uses custom prompt when provided', () => {
      const customPrompt = 'Custom system prompt'
      expect(getSystemPromptForFormat('pptx', customPrompt)).toBe(customPrompt)
      expect(getSystemPromptForFormat('xlsx', customPrompt)).toBe(customPrompt)
    })

    it('custom prompt overrides format-specific prompt', () => {
      const customPrompt = 'My custom prompt'
      expect(getSystemPromptForFormat('pptx', customPrompt)).not.toBe(PPTX_SYSTEM_PROMPT)
      expect(getSystemPromptForFormat('pptx', customPrompt)).toBe(customPrompt)
    })
  })

  describe('buildUserMessage', () => {
    const baseContent: VisionContent = {
      unitIndex: 0,
      unitLabel: 'Slide 1',
      extractedText: 'Hello World',
      embeddedImages: [],
      attributes: {
        unitIndex: 0,
        unitLabel: 'Slide 1',
        kind: 'text-only',
        charCount: 11,
        imageCount: 0,
        textSample: 'Hello World',
        language: 'eng',
      },
    }

    it('builds message with text content', () => {
      const parts = buildUserMessage(baseContent)

      expect(parts.length).toBe(1)
      expect(parts[0].type).toBe('text')
      expect(parts[0].text).toContain('Slide 1')
      expect(parts[0].text).toContain('Hello World')
      expect(parts[0].text).toContain('Extracted Text')
    })

    it('includes rendered image when present', () => {
      const contentWithImage: VisionContent = {
        ...baseContent,
        renderedImage: Buffer.from('fake-png-data'),
      }

      const parts = buildUserMessage(contentWithImage)

      expect(parts.length).toBe(2)
      expect(parts[0].type).toBe('text')
      expect(parts[1].type).toBe('image')
      expect(parts[1].image).toBeInstanceOf(Buffer)
      expect(parts[1].mimeType).toBe('image/png')
    })

    it('includes embedded images when present', () => {
      const contentWithEmbedded: VisionContent = {
        ...baseContent,
        embeddedImages: [
          { id: '0-0-img1.png', data: 'base64data1', mimeType: 'image/png', unitIndex: 0 },
          { id: '0-1-img2.jpg', data: 'base64data2', mimeType: 'image/jpeg', unitIndex: 0 },
        ],
      }

      const parts = buildUserMessage(contentWithEmbedded)

      expect(parts.length).toBe(3) // text + 2 embedded images
      expect(parts[0].type).toBe('text')
      expect(parts[0].text).toContain('2 image(s) detected')
      expect(parts[1].type).toBe('image')
      expect(parts[2].type).toBe('image')
    })

    it('handles empty text content gracefully', () => {
      const emptyContent: VisionContent = {
        ...baseContent,
        extractedText: '',
      }

      const parts = buildUserMessage(emptyContent)

      expect(parts.length).toBe(1)
      expect(parts[0].text).toContain('[No text content]')
    })

    it('includes both rendered and embedded images', () => {
      const fullContent: VisionContent = {
        ...baseContent,
        renderedImage: Buffer.from('fake-png'),
        embeddedImages: [
          { id: '0-0-chart.png', data: 'chartdata', mimeType: 'image/png', unitIndex: 0 },
        ],
      }

      const parts = buildUserMessage(fullContent)

      expect(parts.length).toBe(3) // text + rendered + 1 embedded
    })
  })

  describe('buildBatchMessages', () => {
    const contents: VisionContent[] = [
      {
        unitIndex: 0,
        unitLabel: 'Slide 1',
        extractedText: 'First slide',
        embeddedImages: [],
        attributes: {
          unitIndex: 0,
          unitLabel: 'Slide 1',
          kind: 'text-only',
          charCount: 11,
          imageCount: 0,
          textSample: 'First slide',
          language: 'eng',
        },
      },
      {
        unitIndex: 1,
        unitLabel: 'Slide 2',
        extractedText: 'Second slide',
        embeddedImages: [],
        attributes: {
          unitIndex: 1,
          unitLabel: 'Slide 2',
          kind: 'text-only',
          charCount: 12,
          imageCount: 0,
          textSample: 'Second slide',
          language: 'eng',
        },
      },
    ]

    it('builds messages for all contents', () => {
      const messages = buildBatchMessages(contents, 'pptx')

      expect(messages.length).toBe(2)
      expect(messages[0].unitIndex).toBe(0)
      expect(messages[1].unitIndex).toBe(1)
    })

    it('uses correct system prompt for format', () => {
      const messages = buildBatchMessages(contents, 'pptx')

      expect(messages[0].systemPrompt).toBe(PPTX_SYSTEM_PROMPT)
      expect(messages[1].systemPrompt).toBe(PPTX_SYSTEM_PROMPT)
    })

    it('uses custom prompt when provided', () => {
      const customPrompt = 'Custom batch prompt'
      const messages = buildBatchMessages(contents, 'pptx', customPrompt)

      expect(messages[0].systemPrompt).toBe(customPrompt)
      expect(messages[1].systemPrompt).toBe(customPrompt)
    })

    it('includes user content for each message', () => {
      const messages = buildBatchMessages(contents, 'pptx')

      expect(messages[0].userContent.length).toBeGreaterThan(0)
      expect(messages[0].userContent[0].text).toContain('First slide')
      expect(messages[1].userContent[0].text).toContain('Second slide')
    })
  })

  describe('extractEmbeddedImages', () => {
    it('extracts image attachments', () => {
      const attachments = [
        { name: 'chart.png', type: 'image', data: 'base64data1', mimeType: 'image/png' },
        { name: 'photo.jpg', type: 'image', data: 'base64data2', mimeType: 'image/jpeg' },
      ]

      const images = extractEmbeddedImages(attachments, 0)

      expect(images.length).toBe(2)
      expect(images[0].id).toBe('0-0-chart.png')
      expect(images[0].mimeType).toBe('image/png')
      expect(images[1].id).toBe('0-1-photo.jpg')
      expect(images[1].mimeType).toBe('image/jpeg')
    })

    it('filters out non-image attachments', () => {
      const attachments = [
        { name: 'chart.png', type: 'image', data: 'imagedata' },
        { name: 'doc.pdf', type: 'file', data: 'pdfdata' },
        { name: 'style.css', type: 'style', data: 'cssdata' },
      ]

      const images = extractEmbeddedImages(attachments, 0)

      expect(images.length).toBe(1)
      expect(images[0].filename).toBe('chart.png')
    })

    it('uses default mimeType when not provided', () => {
      const attachments = [{ name: 'image.bin', type: 'image', data: 'bindata' }]

      const images = extractEmbeddedImages(attachments, 0)

      expect(images[0].mimeType).toBe('image/png')
    })

    it('preserves unit index', () => {
      const attachments = [{ name: 'img.png', type: 'image', data: 'data' }]

      const images = extractEmbeddedImages(attachments, 5)

      expect(images[0].unitIndex).toBe(5)
      expect(images[0].id).toBe('5-0-img.png')
    })

    it('returns empty array for no images', () => {
      const attachments = [
        { name: 'doc.pdf', type: 'file', data: 'pdfdata' },
        { name: 'text.txt', type: 'text', data: 'textdata' },
      ]

      const images = extractEmbeddedImages(attachments, 0)

      expect(images).toEqual([])
    })
  })
})
