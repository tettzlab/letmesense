/**
 * Content analysis for Office documents.
 * Analyzes each content unit (slide/sheet/section) and produces ContentAttributes.
 */

import { franc } from 'franc'
import { classifyContentKind } from './classify.js'
import {
  type ContentNode,
  countCharsInNodes,
  countImagesInNodes,
  findNodesByType,
  getContentUnits,
  getSlideNotes,
  getTableData,
  getTextSample,
  type ParsedDocument,
} from './parser.js'
import type {
  AnalyzeOptions,
  ContentAttributes,
  ContentError,
  Lang,
  OfficeFormat,
  SectionAttributes,
  SheetAttributes,
  SlideAttributes,
} from './types.js'

/** Default analysis options */
export const DEFAULT_ANALYZE_OPTIONS: Required<AnalyzeOptions> = {
  minCharsForTextOnly: 20,
  minCharsForLangDetect: 80,
  maxTextSampleChars: 400,
}

/**
 * Detect language from text sample using franc.
 */
function detectLanguage(text: string, minChars: number): Lang {
  if (text.length < minChars) {
    return 'und' // Undetermined
  }

  const lang = franc(text)
  return lang === 'und' ? 'und' : lang
}

/**
 * Generate label for a content unit.
 */
function generateUnitLabel(format: OfficeFormat, index: number, node: ContentNode): string {
  switch (format) {
    case 'pptx':
    case 'odp':
      return `Slide ${index + 1}`

    case 'xlsx':
    case 'ods': {
      const sheetName = (node.metadata?.sheetName as string) ?? `Sheet ${index + 1}`
      return `Sheet: ${sheetName}`
    }

    case 'docx':
    case 'odt': {
      const headings = findNodesByType(node.children ?? [node], 'heading')
      if (headings.length > 0 && headings[0].text) {
        return headings[0].text.slice(0, 50)
      }
      return `Section ${index + 1}`
    }

    default:
      return `Unit ${index + 1}`
  }
}

/**
 * Analyze a single content unit (slide/sheet/section).
 */
function analyzeUnit(
  node: ContentNode,
  index: number,
  format: OfficeFormat,
  options: Required<AnalyzeOptions>,
): ContentAttributes {
  const children = node.children ?? [node]

  const charCount = countCharsInNodes(children)
  const imageCount = countImagesInNodes(children)
  const textSample = getTextSample(children, options.maxTextSampleChars)
  const language = detectLanguage(textSample, options.minCharsForLangDetect)

  const kind = classifyContentKind({
    charCount,
    imageCount,
    minCharsForTextOnly: options.minCharsForTextOnly,
  })

  return {
    unitIndex: index,
    unitLabel: generateUnitLabel(format, index, node),
    kind,
    charCount,
    imageCount,
    textSample,
    language,
  }
}

/**
 * Analyze a PPTX slide and return SlideAttributes.
 */
function analyzeSlide(
  node: ContentNode,
  index: number,
  options: Required<AnalyzeOptions>,
): SlideAttributes {
  const base = analyzeUnit(node, index, 'pptx', options)
  const notesText = getSlideNotes(node)

  return {
    ...base,
    slideNumber: index + 1,
    hasNotes: !!notesText,
    notesText,
  }
}

/**
 * Analyze an XLSX sheet and return SheetAttributes.
 */
function analyzeSheet(
  node: ContentNode,
  index: number,
  options: Required<AnalyzeOptions>,
): SheetAttributes {
  const base = analyzeUnit(node, index, 'xlsx', options)

  // Try to get table data
  const data = getTableData(node)
  const rowCount = data.length
  const columnCount = data.length > 0 ? Math.max(...data.map((row) => row.length)) : 0

  // Check for formulas (would need raw content)
  const hasFormulas = false // TODO: detect from raw XML if available

  const sheetName = (node.metadata?.sheetName as string) ?? `Sheet${index + 1}`

  return {
    ...base,
    unitLabel: `Sheet: ${sheetName}`,
    sheetName,
    rowCount,
    columnCount,
    hasFormulas,
    data: data.length > 0 ? data : undefined,
  }
}

/**
 * Analyze a DOCX section and return SectionAttributes.
 */
function analyzeSection(
  node: ContentNode,
  index: number,
  options: Required<AnalyzeOptions>,
): SectionAttributes {
  const base = analyzeUnit(node, index, 'docx', options)

  const headings = findNodesByType(node.children ?? [node], 'heading')
  const tables = findNodesByType(node.children ?? [node], 'table')

  let headingLevel: number | undefined
  let headingText: string | undefined

  if (headings.length > 0) {
    const firstHeading = headings[0]
    headingText = firstHeading.text?.trim()
    // Try to get level from metadata or formatting
    headingLevel = (firstHeading.metadata?.level as number) ?? 1
  }

  return {
    ...base,
    headingLevel,
    headingText,
    hasTables: tables.length > 0,
  }
}

/**
 * Analyze a single content unit by index.
 *
 * @param parsed - Parsed document from OfficeParser
 * @param index - 0-based unit index
 * @param format - Document format
 * @param options - Analysis options
 * @returns ContentAttributes for the unit
 */
export function analyzeSingleUnit(
  parsed: ParsedDocument,
  index: number,
  format: OfficeFormat,
  options: AnalyzeOptions = {},
): ContentAttributes {
  const opts = { ...DEFAULT_ANALYZE_OPTIONS, ...options }
  const units = getContentUnits(parsed, format)
  const node = units[index]

  if (!node) {
    return {
      unitIndex: index,
      unitLabel: `Unit ${index + 1}`,
      kind: 'unknown',
      charCount: 0,
      imageCount: 0,
      textSample: '',
      language: 'und',
      error: {
        unitIndex: index,
        phase: 'analyze',
        message: `Unit ${index} not found`,
      },
    }
  }

  try {
    switch (format) {
      case 'pptx':
      case 'odp':
        return analyzeSlide(node, index, opts)

      case 'xlsx':
      case 'ods':
        return analyzeSheet(node, index, opts)

      case 'docx':
      case 'odt':
        return analyzeSection(node, index, opts)

      default:
        return analyzeUnit(node, index, format, opts)
    }
  } catch (err) {
    const error: ContentError = {
      unitIndex: index,
      phase: 'analyze',
      message: err instanceof Error ? err.message : String(err),
      cause: err instanceof Error ? err : undefined,
    }

    return {
      unitIndex: index,
      unitLabel: generateUnitLabel(format, index, node),
      kind: 'unknown',
      charCount: 0,
      imageCount: 0,
      textSample: '',
      language: 'und',
      error,
    }
  }
}

/**
 * Analyze all content units in a parsed Office document.
 *
 * @param parsed - Parsed document from OfficeParser
 * @param format - Document format
 * @param options - Analysis options
 * @returns Array of ContentAttributes for each unit
 */
export async function analyzeDocument(
  parsed: ParsedDocument,
  format: OfficeFormat,
  options: AnalyzeOptions = {},
): Promise<ContentAttributes[]> {
  const units = getContentUnits(parsed, format)
  return units.map((_, i) => analyzeSingleUnit(parsed, i, format, options))
}

/**
 * Get summary statistics for analyzed content.
 */
export function getAnalysisSummary(attributes: ContentAttributes[]): {
  totalUnits: number
  textOnlyCount: number
  imageOnlyCount: number
  mixedCount: number
  emptyCount: number
  unknownCount: number
  errorCount: number
  languages: Lang[]
} {
  const summary = {
    totalUnits: attributes.length,
    textOnlyCount: 0,
    imageOnlyCount: 0,
    mixedCount: 0,
    emptyCount: 0,
    unknownCount: 0,
    errorCount: 0,
    languages: new Set<Lang>(),
  }

  for (const attr of attributes) {
    switch (attr.kind) {
      case 'text-only':
        summary.textOnlyCount++
        break
      case 'image-only':
        summary.imageOnlyCount++
        break
      case 'mixed':
        summary.mixedCount++
        break
      case 'empty':
        summary.emptyCount++
        break
      case 'unknown':
        summary.unknownCount++
        break
    }

    if (attr.error) {
      summary.errorCount++
    }

    if (attr.language && attr.language !== 'und') {
      summary.languages.add(attr.language)
    }
  }

  return {
    ...summary,
    languages: [...summary.languages],
  }
}
