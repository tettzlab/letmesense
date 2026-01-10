/**
 * TSV (Tab-Separated Values) formatter.
 */

import type { ExtractResult } from '../types.js'
import type { CellValue, Formatter, FormatterOptions, SheetData } from './types.js'
import { DEFAULT_FORMATTER_OPTIONS } from './types.js'

/**
 * Escape a cell value for TSV format.
 * TSV is simpler than CSV - tabs and newlines need to be escaped.
 */
function escapeTsvCell(value: CellValue): string {
  const str = String(value ?? '')
  // Replace tabs with spaces and newlines with \n literal
  return str.replace(/\t/g, ' ').replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n')
}

/**
 * Format sheet data as TSV.
 */
export function formatSheetAsTsv(data: SheetData, options?: Partial<FormatterOptions>): string {
  const opts = { ...DEFAULT_FORMATTER_OPTIONS, ...options }
  const lineEnding = opts.lineEnding ?? '\n'

  return data.map((row) => row.map((cell) => escapeTsvCell(cell)).join('\t')).join(lineEnding)
}

/**
 * Format extraction result as TSV.
 * For non-spreadsheet documents, this converts text to a single-column TSV.
 */
export function formatAsTsv(result: ExtractResult, options?: Partial<FormatterOptions>): string {
  // For spreadsheets, the text might already be tab-separated
  if (result.format === 'xlsx' || result.format === 'ods') {
    // Already formatted as TSV in extraction
    return result.text
  }

  // For other formats, split into lines
  const lines = result.text.split(/\r?\n/)
  return lines.map((line) => escapeTsvCell(line)).join(options?.lineEnding ?? '\n')
}

/** TSV formatter */
export const tsvFormatter: Formatter = {
  name: 'tsv',
  format: formatAsTsv,
  formatSheet: formatSheetAsTsv,
}
