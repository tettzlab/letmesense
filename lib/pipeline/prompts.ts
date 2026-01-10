/**
 * Prompt composition framework for the extraction pipeline.
 *
 * Prompts are composed from three dimensions:
 * 1. Extraction Mode - Whether we have an image (vision) or just text (text-only)
 * 2. Text Reliability - How to treat the extracted text
 * 3. Document Type - Format-specific instructions
 */

// ============================================================================
// Types
// ============================================================================

/** Extraction mode: vision (image + text) or text-only */
export type ExtractionMode = 'vision' | 'text-only'

/** How reliable is the extracted text */
export type TextReliability = 'digital' | 'ocr-high' | 'ocr-medium' | 'ocr-low' | 'none'

/** Document/file type for format-specific instructions */
export type DocumentType = 'pdf' | 'pptx' | 'xlsx' | 'docx' | 'image'

/** Options for building a prompt */
export interface PromptOptions {
  mode: ExtractionMode
  textReliability: TextReliability
  documentType: DocumentType
}

// ============================================================================
// Prompt Building Blocks
// ============================================================================

/** Base role definition */
const BASE_ROLE_VISION = `You are an expert document analyst. Your task is to analyze this document image and format it as well-structured markdown, preserving all information exactly as presented.`

const BASE_ROLE_TEXT_ONLY = `You are an expert document analyst. Your task is to format the extracted document text as well-structured markdown, preserving all information exactly as presented.`

/** Text reliability instructions for VISION mode (image + text) */
const TEXT_RELIABILITY_VISION: Record<TextReliability, string> = {
  digital: `## Text Source
The provided Extracted Text is accurate and reliable (digitally extracted). Use it as the source of truth for text content, though it may not preserve the correct reading order.
- Use the image to understand structure, layout, and reading order
- Correct any obvious extraction errors visible in the image`,

  'ocr-high': `## Text Source
The provided OCR text has HIGH confidence (≥95%) and is generally reliable, but may have minor errors.
- Use the OCR text as the primary source for text content
- Use the image to verify accuracy, especially for unusual words, names, and special characters
- Fix any OCR errors you spot by comparing with the image`,

  'ocr-medium': `## Text Source
The provided OCR text has MEDIUM confidence (80-95%) and contains some errors. Cross-reference carefully with the image.
- Use the image as the authoritative source when conflicts arise
- The OCR text provides structure hints but may have errors in: unclear words, numbers, special characters, proper nouns
- Verify all text against the image before including it`,

  'ocr-low': `## Text Source
WARNING: The provided OCR text has LOW confidence (<80%) and is unreliable. Use the IMAGE as your primary source.
- Transcribe text content directly from the image
- Use the OCR text only as rough hints for document structure and word boundaries
- Do not trust the OCR text for actual content`,

  none: `## Text Source
No pre-extracted text is available. Read all content directly from the image.
- Transcribe ALL text content verbatim from the image
- Determine reading order from layout and visual flow`,
}

/** Text reliability instructions for TEXT-ONLY mode (no image) */
const TEXT_RELIABILITY_TEXT_ONLY: Record<TextReliability, string> = {
  digital: `## Text Source
The provided text was digitally extracted and is accurate. Format it as markdown while preserving all content.
- The text may not preserve the original reading order or structure
- Infer structure from context (headings, lists, sections)`,

  'ocr-high': `## Text Source
The provided text was OCR'd with HIGH confidence (≥95%) and is generally reliable.
- Minor errors may exist in unusual words, names, or special characters
- Format the text as markdown, fixing obvious typos if spotted`,

  'ocr-medium': `## Text Source
The provided text was OCR'd with MEDIUM confidence (80-95%) and may contain errors.
- Be aware that some words may be garbled or incorrect
- Format as markdown but preserve the text as-is (don't guess corrections)`,

  'ocr-low': `## Text Source
WARNING: The provided text was OCR'd with LOW confidence (<80%) and likely contains significant errors.
- Many words may be incorrect or garbled
- Format as markdown but preserve the text exactly as provided
- Do not attempt to correct errors without visual reference`,

  none: `## Text Source
No text is available to format.`,
}

/** Document type specific instructions for VISION mode */
const DOCUMENT_TYPE_VISION: Record<DocumentType, string> = {
  pdf: `## Document Guidelines
- Preserve the document's structure (headings, lists, tables, columns)
- Identify heading hierarchy from visual cues (larger/bold text)
- Reproduce tables using markdown table syntax
- Represent diagrams, graphs, plots, and charts as ASCII art with labeled descriptions
- Transcribe any text within graphics, callouts, or annotations`,

  pptx: `## Presentation Guidelines
- Format each slide with a heading for the slide title
- Convert bullet points to markdown lists
- Reproduce tables using markdown table syntax
- Represent charts, diagrams, and graphics as ASCII art with labeled descriptions
- Transcribe any text within shapes, callouts, or annotations
- Include speaker notes if provided in a blockquote at the end of each slide`,

  xlsx: `## Spreadsheet Guidelines
- Format tabular data as markdown tables
- Preserve column headers, row labels, and all data values exactly
- Maintain data alignment and grouping where apparent
- Represent charts and visualizations as ASCII art with labeled descriptions
- Transcribe any text within shapes, comments, or annotations
- If multiple sheets are visible, separate them with clear headings`,

  docx: `## Word Document Guidelines
- Preserve heading hierarchy (h1, h2, h3, etc.) based on visual styling
- Reproduce tables using markdown table syntax
- Convert lists (bulleted and numbered) to markdown format
- Represent diagrams, figures, and graphics as ASCII art with labeled descriptions
- Transcribe any text within shapes, callouts, or annotations
- Preserve any headers, footers, or page numbers if visible`,

  image: `## Image Guidelines
- Describe the image content, layout, and visual elements
- If the image contains a document, preserve its structure (headings, lists, tables)
- Represent diagrams, graphs, plots, and charts as ASCII art with labeled descriptions
- Transcribe any text within graphics, callouts, labels, or annotations
- Describe significant visual elements (logos, icons, photos) with brief context`,
}

/** Document type specific instructions for TEXT-ONLY mode (no visual reference) */
const DOCUMENT_TYPE_TEXT_ONLY: Record<DocumentType, string> = {
  pdf: `## Document Guidelines
- Preserve the document's structure (headings, lists, tables)
- Infer heading hierarchy from context and formatting patterns
- Reproduce tables using markdown table syntax
- Preserve any figure/chart references or captions as-is`,

  pptx: `## Presentation Guidelines
- Format each slide section with a heading for the slide title
- Convert bullet points to markdown lists
- Reproduce tables using markdown table syntax
- Include speaker notes if present in a blockquote`,

  xlsx: `## Spreadsheet Guidelines
- Format tabular data as markdown tables
- Preserve column headers, row labels, and all data values exactly
- Maintain data alignment and grouping where apparent
- If multiple sheets are present, separate them with clear headings`,

  docx: `## Word Document Guidelines
- Preserve heading hierarchy based on formatting patterns
- Reproduce tables using markdown table syntax
- Convert lists (bulleted and numbered) to markdown format
- Preserve any headers, footers, or page numbers`,

  image: `## Content Guidelines
- Format the extracted text as markdown
- Preserve any structure apparent from the text`,
}

/** Common rules that apply to all prompts */
const COMMON_RULES = `## Rules
- Preserve URLs, file names, and email addresses exactly as shown
- Do not summarize or interpret any text content
- Do not omit any content
- Do not add content that was not in the original
- Output only markdown, no commentary or explanations`

// ============================================================================
// Prompt Composition
// ============================================================================

/**
 * Build a prompt from all three dimensions: mode, text reliability, and document type.
 */
export function composePrompt(options: PromptOptions): string {
  const { mode, textReliability, documentType } = options

  const baseRole = mode === 'vision' ? BASE_ROLE_VISION : BASE_ROLE_TEXT_ONLY
  const textReliabilityBlock =
    mode === 'vision'
      ? TEXT_RELIABILITY_VISION[textReliability]
      : TEXT_RELIABILITY_TEXT_ONLY[textReliability]
  const documentTypeBlock =
    mode === 'vision' ? DOCUMENT_TYPE_VISION[documentType] : DOCUMENT_TYPE_TEXT_ONLY[documentType]

  return [baseRole, '', textReliabilityBlock, '', documentTypeBlock, '', COMMON_RULES].join('\n')
}

/**
 * Build a prompt for extraction.
 * - Vision mode: Returns prompt without {text} placeholder (text is passed separately via image context)
 * - Text-only mode: Returns prompt with {text} placeholder
 */
export function buildPromptForExtraction(options: PromptOptions): string {
  const base = composePrompt(options)

  if (options.mode === 'vision') {
    // Vision mode: text is passed separately via extractedText parameter
    return base
  }

  // Text-only mode: include {text} placeholder
  const textLabel = options.textReliability === 'none' ? '' : '\n\nExtracted text:\n{text}'
  return base + textLabel
}

// ============================================================================
// Text Reliability Selection
// ============================================================================

/**
 * Determine text reliability from extraction method and confidence.
 */
export function determineTextReliability(
  extractionMethod?: 'digital' | 'ocr' | 'vision' | 'hybrid',
  confidence?: number,
  hasText?: boolean,
): TextReliability {
  // No text available
  if (!hasText) {
    return 'none'
  }

  // Digital extraction (born-digital PDFs, Office docs)
  if (extractionMethod === 'digital' || extractionMethod === undefined) {
    return 'digital'
  }

  // Vision-only (no pre-extraction)
  if (extractionMethod === 'vision') {
    return 'none'
  }

  // OCR or hybrid - use confidence to determine reliability
  if (confidence === undefined) {
    return 'ocr-medium' // Default to medium if no confidence provided
  }
  if (confidence >= 0.95) {
    return 'ocr-high'
  }
  if (confidence >= 0.8) {
    return 'ocr-medium'
  }
  return 'ocr-low'
}

// ============================================================================
// Document Type Selection
// ============================================================================

/** File extensions mapped to document types */
const EXTENSION_TO_DOCTYPE: Record<string, DocumentType> = {
  // PDF
  '.pdf': 'pdf',
  // PowerPoint
  '.pptx': 'pptx',
  '.ppt': 'pptx',
  '.odp': 'pptx',
  // Excel
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.ods': 'xlsx',
  '.csv': 'xlsx',
  // Word
  '.docx': 'docx',
  '.doc': 'docx',
  '.odt': 'docx',
  '.rtf': 'docx',
  // Images
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.bmp': 'image',
  '.tiff': 'image',
  '.tif': 'image',
}

/**
 * Determine document type from file extension.
 * @param extension File extension (e.g., '.pptx') - case insensitive
 * @returns Document type, defaults to 'pdf' if unknown
 */
export function determineDocumentType(extension: string | null | undefined): DocumentType {
  if (!extension) return 'pdf'
  const normalized = extension.toLowerCase()
  return EXTENSION_TO_DOCTYPE[normalized] ?? 'pdf'
}

// ============================================================================
// Pre-built Prompts
// ============================================================================

// Vision mode prompts (no {text} placeholder - text passed separately)
export const VISION_DIGITAL_PDF = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'digital',
  documentType: 'pdf',
})

export const VISION_OCR_HIGH_PDF = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'ocr-high',
  documentType: 'pdf',
})

export const VISION_OCR_MEDIUM_PDF = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'ocr-medium',
  documentType: 'pdf',
})

export const VISION_OCR_LOW_PDF = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'ocr-low',
  documentType: 'pdf',
})

export const VISION_NO_TEXT_PDF = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'none',
  documentType: 'pdf',
})

export const VISION_IMAGE = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'none',
  documentType: 'image',
})

export const VISION_PPTX = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'digital',
  documentType: 'pptx',
})

export const VISION_XLSX = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'digital',
  documentType: 'xlsx',
})

export const VISION_DOCX = buildPromptForExtraction({
  mode: 'vision',
  textReliability: 'digital',
  documentType: 'docx',
})

// Text-only mode prompts (with {text} placeholder)
export const TEXT_ONLY_DIGITAL_PDF = buildPromptForExtraction({
  mode: 'text-only',
  textReliability: 'digital',
  documentType: 'pdf',
})

export const TEXT_ONLY_OCR_HIGH_PDF = buildPromptForExtraction({
  mode: 'text-only',
  textReliability: 'ocr-high',
  documentType: 'pdf',
})

export const TEXT_ONLY_OCR_MEDIUM_PDF = buildPromptForExtraction({
  mode: 'text-only',
  textReliability: 'ocr-medium',
  documentType: 'pdf',
})

export const TEXT_ONLY_OCR_LOW_PDF = buildPromptForExtraction({
  mode: 'text-only',
  textReliability: 'ocr-low',
  documentType: 'pdf',
})
