/**
 * Output formatters for Office document extraction.
 */

import { obs } from '../../observability/index.js'
import { SemanticMetrics } from '../../observability/types.js'

export { csvFormatter, formatAsCsv, formatSheetAsCsv } from './csv.js'
export { formatAsJson, formatSheetAsJson, jsonFormatter } from './json.js'
export { formatAsMarkdown, formatSheetAsMarkdown, markdownFormatter } from './markdown.js'
export { formatAsText, formatSheetAsText, textFormatter } from './text.js'
export { formatAsTsv, formatSheetAsTsv, tsvFormatter } from './tsv.js'
export * from './types.js'

import type { ExtractResult, OutputFormat } from '../types.js'
import { csvFormatter } from './csv.js'
import { jsonFormatter } from './json.js'
import { markdownFormatter } from './markdown.js'
import { textFormatter } from './text.js'
import { tsvFormatter } from './tsv.js'
import type { Formatter, FormatterOptions } from './types.js'

/** Map of format names to formatters */
export const formatters: Record<OutputFormat, Formatter> = {
  text: textFormatter,
  markdown: markdownFormatter,
  tsv: tsvFormatter,
  csv: csvFormatter,
  json: jsonFormatter,
}

/**
 * Get a formatter by name.
 */
export function getFormatter(format: OutputFormat): Formatter {
  const formatter = formatters[format]
  if (!formatter) {
    throw new Error(`Unknown format: ${format}`)
  }
  return formatter
}

/**
 * Format extraction result using the specified format.
 */
export function formatResult(
  result: ExtractResult,
  format: OutputFormat = 'text',
  options?: Partial<FormatterOptions>,
): string {
  const { metrics } = obs('office.formatters')
  const start = performance.now()

  const formatter = getFormatter(format)
  const output = formatter.format(result, options)

  const durationMs = performance.now() - start
  metrics.counter(SemanticMetrics.OFFICE_FORMAT_COUNT).add(1, { format })
  metrics.histogram(SemanticMetrics.OFFICE_FORMAT_DURATION_MS).record(durationMs, { format })

  return output
}
