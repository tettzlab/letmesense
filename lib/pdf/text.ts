import { obs } from '../observability/index.js'
import { SemanticMetrics } from '../observability/types.js'
import { isPdfTextItem } from './pdfjsTypes.js'

export function textItemsToString(items: unknown[]): string {
  const { metrics } = obs('pdf.text')
  const start = performance.now()

  // PDF.js returns an array of text items. This is often "good enough" for full-text
  // extraction; if you need strict reading order, consider sorting by transform coords.
  const result = items
    .map((it) => (isPdfTextItem(it) ? it.str : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const durationMs = performance.now() - start
  metrics.histogram(SemanticMetrics.PDF_TEXT_EXTRACT_DURATION_MS).record(durationMs)

  return result
}
