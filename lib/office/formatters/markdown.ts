/**
 * Markdown formatter.
 * Converts tables to markdown format.
 */

import type { ExtractResult } from '../types.js'
import type { CellValue, Formatter, FormatterOptions, SheetData } from './types.js'
import { DEFAULT_FORMATTER_OPTIONS } from './types.js'

/**
 * Escape special markdown characters in cell content.
 */
function escapeMarkdown(value: CellValue): string {
  const str = String(value ?? '')
  return str.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
}

/**
 * Generate alignment indicator for markdown table.
 */
function getAlignmentIndicator(align: 'left' | 'center' | 'right'): string {
  switch (align) {
    case 'left':
      return ':---'
    case 'center':
      return ':---:'
    case 'right':
      return '---:'
    default:
      return '---'
  }
}

/**
 * Format sheet data as a markdown table.
 */
export function formatSheetAsMarkdown(
  data: SheetData,
  options?: Partial<FormatterOptions>,
): string {
  if (data.length === 0) {
    return ''
  }

  const opts = { ...DEFAULT_FORMATTER_OPTIONS, ...options }
  const hasHeaders = opts.headers && data.length > 1

  const lines: string[] = []

  // Determine column count
  const columnCount = Math.max(...data.map((row) => row.length))

  // Format header row
  const headerRow = hasHeaders
    ? data[0]
    : Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`)
  lines.push(`| ${headerRow.map((cell) => escapeMarkdown(cell)).join(' | ')} |`)

  // Separator row
  const separator = getAlignmentIndicator(opts.alignment ?? 'left')
  lines.push(`| ${Array(columnCount).fill(separator).join(' | ')} |`)

  // Data rows
  const dataRows = hasHeaders ? data.slice(1) : data
  for (const row of dataRows) {
    const cells = Array.from({ length: columnCount }, (_, i) => escapeMarkdown(row[i]))
    lines.push(`| ${cells.join(' | ')} |`)
  }

  return lines.join('\n')
}

/**
 * Format extraction result as markdown.
 */
export function formatAsMarkdown(
  result: ExtractResult,
  _options?: Partial<FormatterOptions>,
): string {
  const lines: string[] = []

  // Add title if available
  if (result.metadata.title) {
    lines.push(`# ${result.metadata.title}`)
    lines.push('')
  }

  // Add metadata section
  const metaItems: string[] = []
  if (result.metadata.author) {
    metaItems.push(`**Author:** ${result.metadata.author}`)
  }
  if (result.metadata.created) {
    metaItems.push(`**Created:** ${result.metadata.created.toISOString().split('T')[0]}`)
  }
  if (result.metadata.modified) {
    metaItems.push(`**Modified:** ${result.metadata.modified.toISOString().split('T')[0]}`)
  }

  if (metaItems.length > 0) {
    lines.push(metaItems.join(' | '))
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  // Add content
  lines.push(result.text)

  // Add error summary if any
  if (result.errors.length > 0) {
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push(`> **Note:** ${result.errors.length} error(s) occurred during extraction.`)
  }

  return lines.join('\n')
}

/** Markdown formatter */
export const markdownFormatter: Formatter = {
  name: 'markdown',
  format: formatAsMarkdown,
  formatSheet: formatSheetAsMarkdown,
}
