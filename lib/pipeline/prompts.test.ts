import {
  buildPromptForExtraction,
  composePrompt,
  type DocumentType,
  determineDocumentType,
  determineTextReliability,
  type ExtractionMode,
  type PromptOptions,
  type TextReliability,
} from './prompts.js'

// ============================================================================
// Test Data
// ============================================================================

const ALL_MODES: ExtractionMode[] = ['vision', 'text-only']
const ALL_TEXT_RELIABILITIES: TextReliability[] = [
  'digital',
  'ocr-high',
  'ocr-medium',
  'ocr-low',
  'none',
]
const ALL_DOCUMENT_TYPES: DocumentType[] = ['pdf', 'pptx', 'xlsx', 'docx', 'image', 'html']

// Phrases that should ONLY appear in vision mode (reference images)
const VISION_ONLY_PHRASES = [
  'Use the image',
  'from the image',
  'in the image',
  'visible in',
  'visual cues',
  'visual flow',
  'visual elements',
  'visual styling',
  'larger/bold text',
  'if visible',
  'are visible',
  'ASCII art',
]

// Phrases that indicate text-only mode (infer without visual reference)
const TEXT_ONLY_PHRASES = ['Infer structure from context', 'Infer heading hierarchy from context']

// ============================================================================
// Comprehensive Prompt Composition Tests
// ============================================================================

describe('Prompt Composition Framework', () => {
  describe('Mode-specific behavior', () => {
    describe('Vision mode prompts', () => {
      it.each(
        ALL_TEXT_RELIABILITIES,
      )('with textReliability=%s references images appropriately', (reliability) => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: reliability,
          documentType: 'pdf',
        })

        // Vision mode should reference analyzing images
        expect(prompt).toContain('document image')

        // Vision mode should NOT have text-only inference phrases
        for (const phrase of TEXT_ONLY_PHRASES) {
          expect(prompt, `Vision mode should not contain "${phrase}"`).not.toContain(phrase)
        }
      })

      it.each(ALL_DOCUMENT_TYPES)('with documentType=%s has visual instructions', (docType) => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'digital',
          documentType: docType,
        })

        // Vision mode should have at least some visual references
        const hasVisualReference = VISION_ONLY_PHRASES.some((phrase) => prompt.includes(phrase))
        expect(hasVisualReference, `Vision mode for ${docType} should have visual references`).toBe(
          true,
        )
      })
    })

    describe('Text-only mode prompts', () => {
      it.each(
        ALL_TEXT_RELIABILITIES,
      )('with textReliability=%s does NOT reference images', (reliability) => {
        // Skip 'none' - text-only mode with no text doesn't make practical sense
        if (reliability === 'none') return

        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: reliability,
          documentType: 'pdf',
        })

        // Text-only mode should NOT reference images
        for (const phrase of VISION_ONLY_PHRASES) {
          expect(prompt, `Text-only mode should not contain "${phrase}"`).not.toContain(phrase)
        }
      })

      it.each(ALL_DOCUMENT_TYPES)('with documentType=%s has no visual instructions', (docType) => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'digital',
          documentType: docType,
        })

        // Text-only mode should NOT have visual references
        for (const phrase of VISION_ONLY_PHRASES) {
          expect(prompt, `Text-only ${docType} should not contain "${phrase}"`).not.toContain(
            phrase,
          )
        }
      })

      it('uses inference-based instructions for structure', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'digital',
          documentType: 'pdf',
        })

        // Should have at least one text-only inference phrase
        const hasInferencePhrase = TEXT_ONLY_PHRASES.some((phrase) => prompt.includes(phrase))
        expect(hasInferencePhrase, 'Text-only mode should have inference-based instructions').toBe(
          true,
        )
      })
    })
  })

  describe('Text reliability instructions', () => {
    describe('Vision mode reliability', () => {
      it('digital: treats text as source of truth', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'digital',
          documentType: 'pdf',
        })
        expect(prompt).toContain('source of truth')
        expect(prompt).toContain('accurate and reliable')
      })

      it('ocr-high: indicates high confidence', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'ocr-high',
          documentType: 'pdf',
        })
        expect(prompt).toContain('HIGH confidence')
        expect(prompt).toContain('generally reliable')
        expect(prompt).toContain('verify')
      })

      it('ocr-medium: instructs to cross-reference', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'ocr-medium',
          documentType: 'pdf',
        })
        expect(prompt).toContain('MEDIUM confidence')
        expect(prompt).toContain('Cross-reference')
        expect(prompt).toContain('image as the authoritative source')
      })

      it('ocr-low: warns text is unreliable', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'ocr-low',
          documentType: 'pdf',
        })
        expect(prompt).toContain('WARNING')
        expect(prompt).toContain('LOW confidence')
        expect(prompt).toContain('unreliable')
        expect(prompt).toContain('IMAGE as your primary source')
      })

      it('none: instructs to read from image', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'none',
          documentType: 'pdf',
        })
        expect(prompt).toContain('No pre-extracted text')
        expect(prompt).toContain('directly from the image')
      })
    })

    describe('Text-only mode reliability', () => {
      it('digital: indicates accurate text', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'digital',
          documentType: 'pdf',
        })
        expect(prompt).toContain('digitally extracted')
        expect(prompt).toContain('accurate')
      })

      it('ocr-high: indicates generally reliable', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'ocr-high',
          documentType: 'pdf',
        })
        expect(prompt).toContain('HIGH confidence')
        expect(prompt).toContain('generally reliable')
      })

      it('ocr-medium: warns about possible errors', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'ocr-medium',
          documentType: 'pdf',
        })
        expect(prompt).toContain('MEDIUM confidence')
        expect(prompt).toContain('may contain errors')
      })

      it('ocr-low: warns about significant errors', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'ocr-low',
          documentType: 'pdf',
        })
        expect(prompt).toContain('WARNING')
        expect(prompt).toContain('LOW confidence')
        expect(prompt).toContain('significant errors')
        // Should NOT suggest using image (we don't have one)
        expect(prompt).not.toContain('Use the image')
      })

      it('none: indicates no text available', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'none',
          documentType: 'pdf',
        })
        expect(prompt).toContain('No text is available')
      })
    })
  })

  describe('Document type instructions', () => {
    describe('Vision mode document types', () => {
      it('pdf: has document-specific guidelines', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'digital',
          documentType: 'pdf',
        })
        expect(prompt).toContain('Document Guidelines')
        expect(prompt).toContain('headings')
        expect(prompt).toContain('tables')
      })

      it('pptx: has presentation-specific guidelines', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'digital',
          documentType: 'pptx',
        })
        expect(prompt).toContain('Presentation Guidelines')
        expect(prompt).toContain('slide')
        expect(prompt).toContain('bullet points')
        expect(prompt).toContain('speaker notes')
      })

      it('xlsx: has spreadsheet-specific guidelines', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'digital',
          documentType: 'xlsx',
        })
        expect(prompt).toContain('Spreadsheet Guidelines')
        expect(prompt).toContain('tabular data')
        expect(prompt).toContain('column headers')
      })

      it('docx: has word document-specific guidelines', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'digital',
          documentType: 'docx',
        })
        expect(prompt).toContain('Word Document Guidelines')
        expect(prompt).toContain('heading hierarchy')
      })

      it('image: has image-specific guidelines', () => {
        const prompt = composePrompt({
          mode: 'vision',
          textReliability: 'none',
          documentType: 'image',
        })
        expect(prompt).toContain('Image Guidelines')
        expect(prompt).toContain('visual elements')
      })
    })

    describe('Text-only mode document types', () => {
      it('pdf: has text-appropriate guidelines', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'digital',
          documentType: 'pdf',
        })
        expect(prompt).toContain('Document Guidelines')
        expect(prompt).toContain('Infer heading hierarchy')
      })

      it('pptx: has presentation guidelines without visual refs', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'digital',
          documentType: 'pptx',
        })
        expect(prompt).toContain('Presentation Guidelines')
        expect(prompt).toContain('slide')
        // Should NOT reference visual elements
        expect(prompt).not.toContain('ASCII art')
      })

      it('xlsx: has spreadsheet guidelines without visual refs', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'digital',
          documentType: 'xlsx',
        })
        expect(prompt).toContain('Spreadsheet Guidelines')
        expect(prompt).toContain('tabular data')
        // Should NOT reference charts/visualizations
        expect(prompt).not.toContain('ASCII art')
      })

      it('docx: has word guidelines without visual refs', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'digital',
          documentType: 'docx',
        })
        expect(prompt).toContain('Word Document Guidelines')
        // Should NOT reference visual styling
        expect(prompt).not.toContain('visual styling')
      })

      it('image: has minimal text-only guidelines', () => {
        const prompt = composePrompt({
          mode: 'text-only',
          textReliability: 'digital',
          documentType: 'image',
        })
        expect(prompt).toContain('Content Guidelines')
        // Should NOT reference describing visual elements
        expect(prompt).not.toContain('visual elements')
      })
    })
  })

  describe('Common rules', () => {
    it.each(ALL_MODES)('mode=%s includes preservation rules', (mode) => {
      const prompt = composePrompt({
        mode,
        textReliability: 'digital',
        documentType: 'pdf',
      })
      expect(prompt).toContain('Preserve URLs')
      expect(prompt).toContain('Do not summarize')
      expect(prompt).toContain('Do not omit')
      expect(prompt).toContain('Do not add content')
      expect(prompt).toContain('Output only markdown')
    })
  })
})

describe('buildPromptForExtraction', () => {
  describe('{text} placeholder handling', () => {
    it('vision mode does NOT include {text} placeholder', () => {
      const prompt = buildPromptForExtraction({
        mode: 'vision',
        textReliability: 'digital',
        documentType: 'pdf',
      })
      expect(prompt).not.toContain('{text}')
    })

    it('text-only mode includes {text} placeholder', () => {
      const prompt = buildPromptForExtraction({
        mode: 'text-only',
        textReliability: 'digital',
        documentType: 'pdf',
      })
      expect(prompt).toContain('{text}')
      expect(prompt).toContain('Extracted text:')
    })

    it('text-only mode with reliability=none does NOT include {text}', () => {
      const prompt = buildPromptForExtraction({
        mode: 'text-only',
        textReliability: 'none',
        documentType: 'pdf',
      })
      // No text available, so no placeholder
      expect(prompt).not.toContain('{text}')
    })

    it.each(
      ALL_TEXT_RELIABILITIES.filter((r) => r !== 'none'),
    )('text-only mode with reliability=%s includes {text}', (reliability) => {
      const prompt = buildPromptForExtraction({
        mode: 'text-only',
        textReliability: reliability,
        documentType: 'pdf',
      })
      expect(prompt).toContain('{text}')
    })
  })
})

describe('All combinations matrix', () => {
  // Generate all possible combinations
  const allCombinations: PromptOptions[] = []
  for (const mode of ALL_MODES) {
    for (const textReliability of ALL_TEXT_RELIABILITIES) {
      for (const documentType of ALL_DOCUMENT_TYPES) {
        allCombinations.push({ mode, textReliability, documentType })
      }
    }
  }

  it(`generates ${allCombinations.length} unique combinations`, () => {
    // 2 modes × 5 reliabilities × 6 doc types = 60 combinations
    expect(allCombinations).toHaveLength(60)
  })

  it.each(
    allCombinations,
  )('mode=$mode, textReliability=$textReliability, documentType=$documentType produces valid prompt', (options) => {
    const prompt = composePrompt(options)

    // Basic validity checks
    expect(prompt).toBeTruthy()
    expect(prompt.length).toBeGreaterThan(100)

    // All prompts should have rules section
    expect(prompt).toContain('## Rules')

    // All prompts should have text source section
    expect(prompt).toContain('## Text Source')

    // Mode-specific checks
    if (options.mode === 'vision') {
      expect(prompt).toContain('document image')
    } else {
      expect(prompt).toContain('extracted document text')
    }
  })
})

describe('determineTextReliability', () => {
  it('returns none when hasText is false', () => {
    expect(determineTextReliability('digital', 1.0, false)).toBe('none')
    expect(determineTextReliability('ocr', 0.99, false)).toBe('none')
  })

  it('returns digital for digital extraction', () => {
    expect(determineTextReliability('digital', undefined, true)).toBe('digital')
    expect(determineTextReliability(undefined, undefined, true)).toBe('digital')
  })

  it('returns none for vision extraction', () => {
    expect(determineTextReliability('vision', undefined, true)).toBe('none')
  })

  describe('OCR confidence thresholds', () => {
    it('≥0.95 returns ocr-high', () => {
      expect(determineTextReliability('ocr', 0.95, true)).toBe('ocr-high')
      expect(determineTextReliability('ocr', 0.99, true)).toBe('ocr-high')
      expect(determineTextReliability('ocr', 1.0, true)).toBe('ocr-high')
    })

    it('0.8-0.95 returns ocr-medium', () => {
      expect(determineTextReliability('ocr', 0.8, true)).toBe('ocr-medium')
      expect(determineTextReliability('ocr', 0.9, true)).toBe('ocr-medium')
      expect(determineTextReliability('ocr', 0.94, true)).toBe('ocr-medium')
      expect(determineTextReliability('ocr', 0.9499, true)).toBe('ocr-medium')
    })

    it('<0.8 returns ocr-low', () => {
      expect(determineTextReliability('ocr', 0.79, true)).toBe('ocr-low')
      expect(determineTextReliability('ocr', 0.5, true)).toBe('ocr-low')
      expect(determineTextReliability('ocr', 0.0, true)).toBe('ocr-low')
    })

    it('undefined confidence returns ocr-medium', () => {
      expect(determineTextReliability('ocr', undefined, true)).toBe('ocr-medium')
      expect(determineTextReliability('hybrid', undefined, true)).toBe('ocr-medium')
    })
  })
})

describe('determineDocumentType', () => {
  describe('PDF extensions', () => {
    it.each(['.pdf', '.PDF'])('%s returns pdf', (ext) => {
      expect(determineDocumentType(ext)).toBe('pdf')
    })
  })

  describe('PowerPoint extensions', () => {
    it.each(['.pptx', '.ppt', '.odp', '.PPTX', '.PPT', '.ODP'])('%s returns pptx', (ext) => {
      expect(determineDocumentType(ext)).toBe('pptx')
    })
  })

  describe('Excel extensions', () => {
    it.each([
      '.xlsx',
      '.xls',
      '.ods',
      '.csv',
      '.XLSX',
      '.XLS',
      '.ODS',
      '.CSV',
    ])('%s returns xlsx', (ext) => {
      expect(determineDocumentType(ext)).toBe('xlsx')
    })
  })

  describe('Word extensions', () => {
    it.each([
      '.docx',
      '.doc',
      '.odt',
      '.rtf',
      '.DOCX',
      '.DOC',
      '.ODT',
      '.RTF',
    ])('%s returns docx', (ext) => {
      expect(determineDocumentType(ext)).toBe('docx')
    })
  })

  describe('Image extensions', () => {
    it.each([
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.svg',
      '.bmp',
      '.tiff',
      '.tif',
    ])('%s returns image', (ext) => {
      expect(determineDocumentType(ext)).toBe('image')
    })

    it.each([
      '.PNG',
      '.JPG',
      '.JPEG',
      '.GIF',
      '.WEBP',
      '.SVG',
      '.BMP',
      '.TIFF',
      '.TIF',
    ])('%s (uppercase) returns image', (ext) => {
      expect(determineDocumentType(ext)).toBe('image')
    })
  })

  describe('Edge cases', () => {
    it('returns pdf for unknown extensions', () => {
      expect(determineDocumentType('.unknown')).toBe('pdf')
      expect(determineDocumentType('.txt')).toBe('pdf')
    })

    it('returns pdf for null/undefined', () => {
      expect(determineDocumentType(null)).toBe('pdf')
      expect(determineDocumentType(undefined)).toBe('pdf')
    })

    it('returns pdf for empty string', () => {
      expect(determineDocumentType('')).toBe('pdf')
    })
  })
})
