/**
 * Plain text formatter.
 */

import type { ExtractResult } from '../types.js'
import type { Formatter, FormatterOptions, SheetData } from './types.js'

/**
 * Format sheet data as plain text (space-separated).
 */
export function formatSheetAsText(data: SheetData): string {
  return data.map((row) => row.map((cell) => String(cell ?? '')).join(' ')).join('\n')
}

/**
 * Format extraction result as plain text.
 */
export function formatAsText(result: ExtractResult, _options?: Partial<FormatterOptions>): string {
  return result.text
}

/** Plain text formatter */
export const textFormatter: Formatter = {
  name: 'text',
  format: formatAsText,
  formatSheet: formatSheetAsText,
}
