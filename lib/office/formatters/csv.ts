/**
 * CSV (Comma-Separated Values) formatter.
 * Follows RFC 4180 for proper escaping.
 */

import type { ExtractResult } from '../types.js'
import type { CellValue, Formatter, FormatterOptions, SheetData } from './types.js'
import { DEFAULT_FORMATTER_OPTIONS } from './types.js'

/**
 * Escape a cell value for CSV format following RFC 4180.
 * - Fields containing commas, quotes, or newlines must be quoted
 * - Quotes within quoted fields must be doubled
 */
function escapeCsvCell(value: CellValue, delimiter = ','): string {
  const str = String(value ?? '')

  // Check if quoting is needed
  const needsQuoting =
    str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')

  if (!needsQuoting) {
    return str
  }

  // Double any existing quotes and wrap in quotes
  return `"${str.replace(/"/g, '""')}"`
}

/**
 * Format sheet data as CSV.
 */
export function formatSheetAsCsv(data: SheetData, options?: Partial<FormatterOptions>): string {
  const opts = { ...DEFAULT_FORMATTER_OPTIONS, ...options }
  const delimiter = opts.delimiter ?? ','
  const lineEnding = opts.lineEnding ?? '\n'

  return data
    .map((row) => row.map((cell) => escapeCsvCell(cell, delimiter)).join(delimiter))
    .join(lineEnding)
}

/**
 * Format extraction result as CSV.
 * For non-spreadsheet documents, converts text to single-column CSV.
 */
export function formatAsCsv(result: ExtractResult, options?: Partial<FormatterOptions>): string {
  const opts = { ...DEFAULT_FORMATTER_OPTIONS, ...options }
  const delimiter = opts.delimiter ?? ','
  const lineEnding = opts.lineEnding ?? '\n'

  // For spreadsheets, we need to re-parse and format
  if (result.format === 'xlsx' || result.format === 'ods') {
    // The text is tab-separated, convert to CSV
    const lines = result.text.split(/\r?\n/)
    return lines
      .map((line) => {
        const cells = line.split('\t')
        return cells.map((cell) => escapeCsvCell(cell, delimiter)).join(delimiter)
      })
      .join(lineEnding)
  }

  // For other formats, each line becomes a single-cell row
  const lines = result.text.split(/\r?\n/)
  return lines.map((line) => escapeCsvCell(line, delimiter)).join(lineEnding)
}

/** CSV formatter */
export const csvFormatter: Formatter = {
  name: 'csv',
  format: formatAsCsv,
  formatSheet: formatSheetAsCsv,
}
