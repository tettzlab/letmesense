/** PDF format plugin span and metric names. */

export const Spans = {
  LOAD: 'pdf.plugin.load',
  PARSE: 'pdf.plugin.parse',
  ANALYZE_UNIT: 'pdf.plugin.analyze.unit',
  EXTRACT_UNIT: 'pdf.plugin.extract.unit',
  RENDER_UNIT: 'pdf.plugin.render.unit',
} as const

export const Metrics = {
  LOAD_COUNT: 'pdf.plugin.load.count',
  LOAD_BYTES: 'pdf.plugin.load.bytes',
  UNIT_COUNT: 'pdf.plugin.unit.count',
  ANALYZE_PAGE_COUNT: 'pdf.plugin.analyze.page.count',
  EXTRACT_PAGE_COUNT: 'pdf.plugin.extract.page.count',
  EXTRACT_CHARS: 'pdf.plugin.extract.chars',
  RENDER_PAGE_COUNT: 'pdf.plugin.render.page.count',
  RENDER_BYTES: 'pdf.plugin.render.bytes',
} as const
