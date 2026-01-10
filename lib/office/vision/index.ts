/**
 * Vision mode for Office document extraction.
 * Combines OfficeParser text extraction with LibreOffice rendering
 * for LLM-powered markdown formatting.
 */

// Processor (main orchestration)
export {
  estimateVisionCost,
  formatOfficeWithVision,
  prepareVisionContent,
  type VisionFormatOptions,
  type VisionFormatResult,
} from './processor.js'

// Prompts
export {
  buildBatchMessages,
  buildUserMessage,
  DEFAULT_SYSTEM_PROMPT,
  DOCX_SYSTEM_PROMPT,
  extractEmbeddedImages,
  getSystemPromptForFormat,
  PPTX_SYSTEM_PROMPT,
  XLSX_SYSTEM_PROMPT,
} from './prompt.js'

// Rendering
export {
  convertDocumentToPdf,
  type PdfConversionResult,
  renderDocumentToImages,
  renderManyToImages,
} from './render.js'

// Types
export * from './types.js'
