/**
 * Build prompts for vision LLM processing.
 */

import type { ImageAttachment, VisionContent } from './types.js'

/** System prompt for vision LLM */
export const DEFAULT_SYSTEM_PROMPT = `You are an expert document analyst. Your task is to analyze document content including document structures, layouts, visual representations), and format it as well-structured markdown, preserving all information exactly as presented at your best.

Guidelines:
- Use the provided Extracted Text as the source of truth for text content (it is accurate but may not be properly ordered)
- Ensure to preserve URLs, file names, and email addresses as shown in the provided text
- Transcribe ALL text content verbatim from the rendered image
- Preserve the document's structure (headings, lists, tables, columns)
- Reproduce tables using markdown table syntax
- Represent diagrams, graphs, plots, and charts as ASCII art with labeled descriptions
- Transcribe any text within graphics, callouts, or annotations
- Do not summarize, interpret any text content except for layouts, diagrams, graphs, plots, and charts
- Do not omit any content
- Output only markdown, no commentary`

/** System prompt for PPTX slides */

export const PPTX_SYSTEM_PROMPT = `You are an expert presentation analyst. Your task is to analyze PowerPoint slides and format them as well-structured markdown, preserving all information exactly as presented at your best.

Guidelines:
- Use the provided Extracted Text as the source of truth for text content (it is accurate but may not be properly ordered)
- Ensure to preserve URLs, file names, and email addresses as shown in the provided text
- Transcribe ALL text content verbatim from the slide image
- Format each slide with a heading for the slide title
- Convert bullet points to markdown lists
- Reproduce tables using markdown table syntax
- Represent charts, diagrams, and graphics as ASCII art with labeled descriptions
- Transcribe any text within shapes, callouts, or annotations
- Include speaker notes if provided
- Do not summarize, interpret any text content except for layouts, diagrams, graphs, plots, and charts
- Do not omit any content
- Output only markdown, no commentary`

/** System prompt for XLSX spreadsheets */
export const XLSX_SYSTEM_PROMPT = `You are an expert spreadsheet analyst. Your task is to analyze Excel sheets and format them as well-structured markdown, preserving all information exactly as presented at your best.

Guidelines:
- Use the provided Extracted Text as the source of truth for text content (it is accurate but may not be properly ordered)
- Ensure to preserve URLs, file names, and email addresses as shown in the provided text
- Transcribe ALL cell content verbatim from the sheet image
- Format tabular data as markdown tables
- Preserve column headers, row labels, data types, and all data values
- Represent charts and visualizations as ASCII art with labeled descriptions
- Transcribe any text within shapes, comments, or annotations
- Do not summarize, interpret any text content except for layouts, diagrams, graphs, plots, and charts
- Do not omit any content
- Output only markdown, no commentary`

/** System prompt for DOCX documents */
export const DOCX_SYSTEM_PROMPT = `You are an expert document analyst. Your task is to analyze Word documents and format them as well-structured markdown, preserving all information exactly as presented at your best.

Guidelines:
- Use the provided Extracted Text as the source of truth for text content (it is accurate but may not be properly ordered)
- Ensure to preserve URLs, file names, and email addresses as shown in the provided text
- Transcribe ALL text content verbatim from the document image
- Preserve heading hierarchy (h1, h2, h3, etc.)
- Reproduce tables using markdown table syntax
- Convert lists to markdown format
- Represent diagrams, figures, and graphics as ASCII art with labeled descriptions
- Transcribe any text within shapes, callouts, or annotations
- Do not summarize, interpret any text content except for layouts, diagrams, graphs, plots, and charts
- Do not omit any content
- Output only markdown, no commentary`

/**
 * Get the appropriate system prompt for a document format.
 */
export function getSystemPromptForFormat(format: string, customPrompt?: string): string {
  if (customPrompt) {
    return customPrompt
  }

  switch (format) {
    case 'pptx':
    case 'odp':
      return PPTX_SYSTEM_PROMPT
    case 'xlsx':
    case 'ods':
      return XLSX_SYSTEM_PROMPT
    case 'docx':
    case 'odt':
      return DOCX_SYSTEM_PROMPT
    default:
      return DEFAULT_SYSTEM_PROMPT
  }
}

/**
 * Build the user message content for a vision LLM call.
 */
export function buildUserMessage(content: VisionContent): Array<{
  type: 'text' | 'image'
  text?: string
  image?: Buffer
  mimeType?: string
}> {
  const parts: Array<{
    type: 'text' | 'image'
    text?: string
    image?: Buffer
    mimeType?: string
  }> = []

  // Add text context
  let textContent = `## ${content.unitLabel}\n\n`
  textContent += `### Extracted Text (source of truth):\n\n`
  textContent += content.extractedText || '[No text content]'
  textContent += '\n\n'

  if (content.embeddedImages.length > 0) {
    textContent += `### Embedded Images: ${content.embeddedImages.length} image(s) detected\n\n`
  }

  textContent += `Please transcribe this content as clean markdown.`

  parts.push({ type: 'text', text: textContent })

  // Add rendered image if available
  if (content.renderedImage) {
    parts.push({
      type: 'image',
      image: content.renderedImage,
      mimeType: 'image/png',
    })
  }

  // Add embedded images
  for (const img of content.embeddedImages) {
    parts.push({
      type: 'image',
      image: Buffer.from(img.data, 'base64'),
      mimeType: img.mimeType,
    })
  }

  return parts
}

/**
 * Build messages for batch processing multiple content units.
 */
export function buildBatchMessages(
  contents: VisionContent[],
  format: string,
  customPrompt?: string,
): Array<{
  systemPrompt: string
  userContent: ReturnType<typeof buildUserMessage>
  unitIndex: number
}> {
  const systemPrompt = getSystemPromptForFormat(format, customPrompt)

  return contents.map((content) => ({
    systemPrompt,
    userContent: buildUserMessage(content),
    unitIndex: content.unitIndex,
  }))
}

/**
 * Extract embedded images from OfficeParser attachments.
 */
export function extractEmbeddedImages(
  attachments: Array<{
    name: string
    type: string
    data: string
    mimeType?: string
  }>,
  unitIndex: number,
): ImageAttachment[] {
  return attachments
    .filter((att) => att.type === 'image')
    .map((att, i) => ({
      id: `${unitIndex}-${i}-${att.name}`,
      data: att.data,
      mimeType: att.mimeType ?? 'image/png',
      unitIndex,
      filename: att.name,
    }))
}
