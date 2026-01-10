/**
 * Office document extraction library.
 *
 * Provides text extraction from DOCX, PPTX, XLSX, ODT, ODP, ODS files
 * with consistent ergonomics to letmesense.
 *
 * @example
 * ```ts
 * import { extractFromOffice } from '../lib/office'
 *
 * // Simple extraction
 * const result = await extractFromOffice('presentation.pptx')
 * console.log(result.text)
 *
 * // With options
 * const result = await extractFromOffice('document.docx', {
 *   includeNotes: true,
 *   strict: false,
 * })
 *
 * // Format output
 * import { formatResult } from '../lib/office/formatters'
 * const markdown = formatResult(result, 'markdown')
 * ```
 */

// Analysis
export {
  analyzeDocument,
  DEFAULT_ANALYZE_OPTIONS,
  getAnalysisSummary,
} from './analyze.js'
// Classification
export {
  CLASSIFICATION_DEFAULTS,
  type ClassifyOptions,
  classifyContentKind,
  classifyWithCoverage,
  describeContentKind,
  mightBenefitFromOcr,
  requiresOcr,
} from './classify.js'
// Conversion (LibreOffice)
export * from './convert/index.js'
// Error classes
export {
  getLibreOfficeInstallInstructions,
  OfficeAnalyzeError,
  OfficeConvertError,
  OfficeExtractError,
  OfficeExtractionError,
  OfficeLoadError,
  OfficeParseError,
  OfficeVisionError,
} from './errors.js'
// Main entry point
export {
  type ExtractAllOptions,
  extractFromOffice,
  extractFromOfficeDetailed,
  extractTextQuick,
} from './extractAll.js'
// Text extraction
export {
  concatenateExtracted,
  type ExtractedUnit,
  extractText,
  extractTextByRun,
  filterSheetsByName,
  getExtractionErrors,
  parseSlideRange,
} from './extractText.js'
// Formatters
export * from './formatters/index.js'
// Loader
export {
  detectFormatFromExtension,
  detectFormatFromMime,
  detectInputType,
  getSupportedExtensions,
  getSupportedFormats,
  isSupportedFormat,
  type LoadOptions,
  type LoadResult,
  loadOfficeDocument,
} from './loader.js'
// Parser
export {
  type ContentNode,
  extractMetadata,
  extractTextFromNodes,
  findNodesByType,
  getContentUnits,
  getSections,
  getSheets,
  getSlides,
  type ParsedDocument,
  type ParseOptions,
  parseOfficeBuffer,
  parseOfficeFile,
  walkContentNodes,
} from './parser.js'
// Run splitting
export {
  filterRunsByKind,
  generateRunKey,
  getDominantLanguage,
  getExtractableRuns,
  getOcrRequiredRuns,
  getRunStats,
  getUnitIndicesFromRuns,
  mergeRunsByKind,
  sortRunsByIndex,
  splitIntoRuns,
} from './splitRuns.js'
// Core types
export type {
  AnalyzeOptions,
  ContentAttributes,
  ContentError,
  ContentErrorPhase,
  ContentKind,
  ContentRun,
  DocumentMetadata,
  ExtractOptions,
  ExtractResult,
  Lang,
  OfficeFormat,
  OfficeFormatOptions,
  OfficeInput,
  OutputFormat,
  ProgressCallbacks,
  SectionAttributes,
  SheetAttributes,
  SlideAttributes,
} from './types.js'

// Vision mode
export * from './vision/index.js'
