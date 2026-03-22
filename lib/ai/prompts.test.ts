import {
  buildPrompt,
  CONTINUITY_PROMPT_PREFIX,
  DEFAULT_TEXT_PROMPT,
  DEFAULT_VISION_PROMPT,
  determineDocumentType,
  determineTextReliability,
  PROMPTS,
  substituteVariables,
} from './prompts.js'
import type { PageContext } from './types.js'

const createContext = (overrides?: Partial<PageContext>): PageContext => ({
  text: 'Sample text content',
  page: 1,
  totalPages: 10,
  language: 'eng',
  pageKind: 'born-digital',
  previousTail: 'previous page ending...',
  runIndex: 0,
  ...overrides,
})

describe('PROMPTS', () => {
  it('exports all built-in prompts', () => {
    expect(PROMPTS.DEFAULT_TEXT).toBe(DEFAULT_TEXT_PROMPT)
    expect(PROMPTS.DEFAULT_VISION).toBe(DEFAULT_VISION_PROMPT)
    expect(PROMPTS.OCR_HIGH_CONFIDENCE).toBeDefined()
    expect(PROMPTS.OCR_MEDIUM_CONFIDENCE).toBeDefined()
    expect(PROMPTS.OCR_LOW_CONFIDENCE).toBeDefined()
    expect(PROMPTS.IMAGE_ONLY).toBeDefined()
    expect(PROMPTS.IMAGE_VISION).toBeDefined()
    expect(PROMPTS.PPTX).toBeDefined()
    expect(PROMPTS.XLSX).toBeDefined()
    expect(PROMPTS.DOCX).toBeDefined()
  })

  it('text-only mode prompts have {text} placeholder, vision mode prompts do not', () => {
    // Text-only mode prompts have {text} placeholder
    const textOnlyPrompts = [
      'DEFAULT_TEXT',
      'TEXT_ONLY',
      'TEXT_ONLY_OCR_HIGH',
      'TEXT_ONLY_OCR_MEDIUM',
      'TEXT_ONLY_OCR_LOW',
    ]
    // Vision mode prompts do NOT have {text} placeholder (text passed separately)
    const visionPrompts = [
      'DEFAULT_VISION',
      'OCR_HIGH_CONFIDENCE',
      'OCR_MEDIUM_CONFIDENCE',
      'OCR_LOW_CONFIDENCE',
      'IMAGE_ONLY',
      'IMAGE_VISION',
      'PPTX',
      'XLSX',
      'DOCX',
    ]

    for (const [name, prompt] of Object.entries(PROMPTS)) {
      if (textOnlyPrompts.includes(name)) {
        expect(prompt, `${name} should contain {text}`).toContain('{text}')
      } else if (visionPrompts.includes(name)) {
        expect(prompt, `${name} should NOT contain {text}`).not.toContain('{text}')
      } else {
        throw new Error(`Unknown prompt: ${name} - please add to test`)
      }
    }
  })
})

describe('substituteVariables', () => {
  it('substitutes basic variables', () => {
    const template = 'Page {page} of {totalPages}'
    const context = createContext({ page: 5, totalPages: 20 })

    const result = substituteVariables(template, context)

    expect(result).toBe('Page 5 of 20')
  })

  it('substitutes text variable', () => {
    const template = 'Content:\n{text}'
    const context = createContext({ text: 'Hello world' })

    const result = substituteVariables(template, context)

    expect(result).toBe('Content:\nHello world')
  })

  it('supports both camelCase and snake_case variable names', () => {
    const template = '{totalPages} = {total_pages}, {pageKind} = {page_kind}'
    const context = createContext({ totalPages: 5, pageKind: 'scanned' })

    const result = substituteVariables(template, context)

    expect(result).toBe('5 = 5, scanned = scanned')
  })

  it('preserves unrecognized variables', () => {
    const template = 'Known: {page}, Unknown: {unknown}'
    const context = createContext()

    const result = substituteVariables(template, context)

    expect(result).toContain('Known: 1')
    expect(result).toContain('Unknown: {unknown}')
  })

  it('applies custom variables', () => {
    const template = 'Page {page}, Custom: {myVar}'
    const context = createContext()

    const result = substituteVariables(template, context, { myVar: 'customValue' })

    expect(result).toContain('Custom: customValue')
  })

  it('custom variables override built-in variables', () => {
    const template = 'Page: {page}'
    const context = createContext({ page: 1 })

    const result = substituteVariables(template, context, { page: 'CUSTOM' })

    expect(result).toBe('Page: CUSTOM')
  })

  it('handles empty text', () => {
    const template = 'Text: {text}'
    const context = createContext({ text: '' })

    const result = substituteVariables(template, context)

    expect(result).toBe('Text: ')
  })

  it('excludes specified keys from substitution', () => {
    const template = 'Content:\n{text}\nPage: {page}'
    const context = createContext()

    const result = substituteVariables(template, context, undefined, {
      excludeKeys: ['text'],
    })

    expect(result).toContain('{text}')
    expect(result).toContain('Page: 1')
  })

  it('excludes multiple keys', () => {
    const template = '{text} on page {page} of {totalPages}'
    const context = createContext({ page: 3, totalPages: 10 })

    const result = substituteVariables(template, context, undefined, {
      excludeKeys: ['text', 'page'],
    })

    expect(result).toContain('{text}')
    expect(result).toContain('{page}')
    expect(result).toContain('of 10')
  })
})

describe('buildPrompt', () => {
  it('builds prompt without continuity for first page', () => {
    const template = 'Format this:\n{text}'
    const context = createContext({ page: 1 })

    const result = buildPrompt(template, context, { includeContinuity: true })

    expect(result).not.toContain('previous page')
    expect(result).toBe('Format this:\nSample text content')
  })

  it('adds continuity prefix for subsequent pages', () => {
    const template = 'Format this:\n{text}'
    const context = createContext({ page: 2, previousTail: 'ending of page 1' })

    const result = buildPrompt(template, context, { includeContinuity: true })

    expect(result).toContain('page 2 of 10')
    expect(result).toContain('ending of page 1')
    expect(result).toContain('Format this:')
  })

  it('skips continuity when disabled', () => {
    const template = 'Format this:\n{text}'
    const context = createContext({ page: 5 })

    const result = buildPrompt(template, context, { includeContinuity: false })

    expect(result).not.toContain('previous page')
    expect(result).toBe('Format this:\nSample text content')
  })

  it('skips continuity when previousTail is empty', () => {
    const template = 'Format this:\n{text}'
    const context = createContext({ page: 5, previousTail: '' })

    const result = buildPrompt(template, context, { includeContinuity: true })

    expect(result).not.toContain('Previous page ended')
  })

  it('applies custom variables', () => {
    const template = 'Format {docType}:\n{text}'
    const context = createContext()

    const result = buildPrompt(template, context, {
      customVariables: { docType: 'invoice' },
    })

    expect(result).toContain('Format invoice:')
  })
})

describe('CONTINUITY_PROMPT_PREFIX', () => {
  it('contains required variables', () => {
    expect(CONTINUITY_PROMPT_PREFIX).toContain('{page}')
    expect(CONTINUITY_PROMPT_PREFIX).toContain('{totalPages}')
    expect(CONTINUITY_PROMPT_PREFIX).toContain('{previousTail}')
  })
})

describe('DEFAULT_TEXT_PROMPT', () => {
  it('contains rules for formatting', () => {
    // New composed prompt uses modular structure
    expect(DEFAULT_TEXT_PROMPT).toContain('heading hierarchy')
    expect(DEFAULT_TEXT_PROMPT).toContain('lists')
    expect(DEFAULT_TEXT_PROMPT).toContain('tables')
  })

  it('instructs not to add content', () => {
    expect(DEFAULT_TEXT_PROMPT).toContain('Do not add content')
  })

  it('is appropriate for text-only mode (no visual references)', () => {
    // Text-only mode should NOT reference images
    expect(DEFAULT_TEXT_PROMPT).not.toContain('Use the image')
    expect(DEFAULT_TEXT_PROMPT).not.toContain('visual')
    expect(DEFAULT_TEXT_PROMPT).toContain('Infer structure from context')
  })
})

describe('DEFAULT_VISION_PROMPT', () => {
  it('instructs to use text as source of truth', () => {
    expect(DEFAULT_VISION_PROMPT).toContain('source of truth for text content')
  })

  it('instructs to use image for layout', () => {
    expect(DEFAULT_VISION_PROMPT).toContain('Use the image to understand')
    expect(DEFAULT_VISION_PROMPT).toContain('headings')
    expect(DEFAULT_VISION_PROMPT).toContain('layout')
  })
})

describe('OCR prompts', () => {
  it('OCR_HIGH_CONFIDENCE indicates text is generally reliable', () => {
    expect(PROMPTS.OCR_HIGH_CONFIDENCE).toContain('HIGH confidence')
    expect(PROMPTS.OCR_HIGH_CONFIDENCE).toContain('generally reliable')
  })

  it('OCR_MEDIUM_CONFIDENCE instructs to cross-reference with image', () => {
    expect(PROMPTS.OCR_MEDIUM_CONFIDENCE).toContain('MEDIUM confidence')
    expect(PROMPTS.OCR_MEDIUM_CONFIDENCE).toContain('Cross-reference')
  })

  it('OCR_LOW_CONFIDENCE warns text is unreliable', () => {
    expect(PROMPTS.OCR_LOW_CONFIDENCE).toContain('unreliable')
    expect(PROMPTS.OCR_LOW_CONFIDENCE).toContain('IMAGE as your primary source')
  })

  it('IMAGE_ONLY handles no-text case', () => {
    expect(PROMPTS.IMAGE_ONLY).toContain('No pre-extracted text is available')
    expect(PROMPTS.IMAGE_ONLY).not.toContain('{text}')
  })
})

describe('determineTextReliability', () => {
  it('returns none when hasText is false', () => {
    expect(determineTextReliability('digital', 1.0, false)).toBe('none')
  })

  it('returns digital for digital extraction', () => {
    expect(determineTextReliability('digital', undefined, true)).toBe('digital')
    expect(determineTextReliability(undefined, undefined, true)).toBe('digital')
  })

  it('returns none for vision extraction', () => {
    expect(determineTextReliability('vision', undefined, true)).toBe('none')
  })

  it('returns ocr-high for OCR with >= 0.95 confidence', () => {
    expect(determineTextReliability('ocr', 0.95, true)).toBe('ocr-high')
    expect(determineTextReliability('ocr', 0.99, true)).toBe('ocr-high')
  })

  it('returns ocr-medium for OCR with 0.8-0.95 confidence', () => {
    expect(determineTextReliability('ocr', 0.8, true)).toBe('ocr-medium')
    expect(determineTextReliability('ocr', 0.94, true)).toBe('ocr-medium')
  })

  it('returns ocr-low for OCR with < 0.8 confidence', () => {
    expect(determineTextReliability('ocr', 0.79, true)).toBe('ocr-low')
    expect(determineTextReliability('ocr', 0.5, true)).toBe('ocr-low')
  })

  it('returns ocr-medium when confidence is undefined for OCR', () => {
    expect(determineTextReliability('ocr', undefined, true)).toBe('ocr-medium')
  })
})

describe('determineDocumentType', () => {
  it('returns pdf for .pdf extension', () => {
    expect(determineDocumentType('.pdf')).toBe('pdf')
  })

  it('returns pptx for PowerPoint extensions', () => {
    expect(determineDocumentType('.pptx')).toBe('pptx')
    expect(determineDocumentType('.ppt')).toBe('pptx')
    expect(determineDocumentType('.odp')).toBe('pptx')
  })

  it('returns xlsx for Excel extensions', () => {
    expect(determineDocumentType('.xlsx')).toBe('xlsx')
    expect(determineDocumentType('.xls')).toBe('xlsx')
    expect(determineDocumentType('.ods')).toBe('xlsx')
    expect(determineDocumentType('.csv')).toBe('xlsx')
  })

  it('returns docx for Word extensions', () => {
    expect(determineDocumentType('.docx')).toBe('docx')
    expect(determineDocumentType('.doc')).toBe('docx')
    expect(determineDocumentType('.odt')).toBe('docx')
  })

  it('returns image for image extensions', () => {
    expect(determineDocumentType('.png')).toBe('image')
    expect(determineDocumentType('.jpg')).toBe('image')
    expect(determineDocumentType('.jpeg')).toBe('image')
    expect(determineDocumentType('.gif')).toBe('image')
    expect(determineDocumentType('.webp')).toBe('image')
    expect(determineDocumentType('.svg')).toBe('image')
  })

  it('is case insensitive', () => {
    expect(determineDocumentType('.PDF')).toBe('pdf')
    expect(determineDocumentType('.PPTX')).toBe('pptx')
    expect(determineDocumentType('.PNG')).toBe('image')
  })

  it('returns pdf for unknown extensions', () => {
    expect(determineDocumentType('.unknown')).toBe('pdf')
    expect(determineDocumentType(null)).toBe('pdf')
    expect(determineDocumentType(undefined)).toBe('pdf')
  })
})
