/** Office format plugin span and metric names. */

export const Spans = {
  LOAD: 'office.plugin.load',
  PARSE: 'office.plugin.parse',
  ANALYZE_UNIT: 'office.plugin.analyze.unit',
  EXTRACT_UNIT: 'office.plugin.extract.unit',
  RENDER_UNIT: 'office.plugin.render.unit',
  CONVERT_TO_PDF: 'office.plugin.convert.to.pdf',
} as const

export const Metrics = {
  LOAD_COUNT: 'office.plugin.load.count',
  LOAD_BYTES: 'office.plugin.load.bytes',
  UNIT_COUNT: 'office.plugin.unit.count',
  ANALYZE_UNIT_COUNT: 'office.plugin.analyze.unit.count',
  EXTRACT_UNIT_COUNT: 'office.plugin.extract.unit.count',
  EXTRACT_CHARS: 'office.plugin.extract.chars',
  PDF_CONVERSION_COUNT: 'office.plugin.pdf.conversion.count',
  RENDER_UNIT_COUNT: 'office.plugin.render.unit.count',
  RENDER_BYTES: 'office.plugin.render.bytes',
} as const
