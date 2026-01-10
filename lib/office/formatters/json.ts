/**
 * JSON formatter.
 * Outputs extraction result as JSON with metadata.
 */

import type { ExtractResult } from '../types.js'
import type { Formatter, FormatterOptions, SheetData } from './types.js'
import { DEFAULT_FORMATTER_OPTIONS } from './types.js'

/**
 * Convert sheet data to JSON-friendly format.
 * If headers option is true, converts to array of objects.
 * Otherwise, returns as 2D array.
 */
export function formatSheetAsJson(data: SheetData, options?: Partial<FormatterOptions>): string {
  const opts = { ...DEFAULT_FORMATTER_OPTIONS, ...options }
  const indent = opts.prettyPrint ? opts.indent : undefined

  if (opts.headers && data.length > 1) {
    // Convert to array of objects using first row as headers
    const headers = data[0].map((h, i) => String(h ?? `column_${i}`))
    const rows = data.slice(1).map((row) => {
      const obj: Record<string, unknown> = {}
      headers.forEach((header, i) => {
        obj[header] = row[i] ?? null
      })
      return obj
    })
    return JSON.stringify(rows, null, indent)
  }

  // Return as 2D array
  return JSON.stringify(data, null, indent)
}

/**
 * Format extraction result as JSON.
 */
export function formatAsJson(result: ExtractResult, options?: Partial<FormatterOptions>): string {
  const opts = { ...DEFAULT_FORMATTER_OPTIONS, ...options }
  const indent = opts.prettyPrint ? opts.indent : undefined

  const output = {
    source: result.source,
    format: result.format,
    unitCount: result.unitCount,
    runCount: result.runCount,
    metadata: {
      author: result.metadata.author ?? null,
      title: result.metadata.title ?? null,
      subject: result.metadata.subject ?? null,
      keywords: result.metadata.keywords ?? null,
      created: result.metadata.created?.toISOString() ?? null,
      modified: result.metadata.modified?.toISOString() ?? null,
      lastModifiedBy: result.metadata.lastModifiedBy ?? null,
      revision: result.metadata.revision ?? null,
    },
    text: result.text,
    errors:
      result.errors.length > 0
        ? result.errors.map((e) => ({
            unitIndex: e.unitIndex,
            phase: e.phase,
            message: e.message,
          }))
        : [],
  }

  return JSON.stringify(output, null, indent)
}

/** JSON formatter */
export const jsonFormatter: Formatter = {
  name: 'json',
  format: formatAsJson,
  formatSheet: formatSheetAsJson,
}
