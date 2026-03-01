/** Image format plugin span and metric names. */

export const Spans = {
  LOAD: 'image.plugin.load',
  PARSE: 'image.plugin.parse',
  ANALYZE_UNIT: 'image.plugin.analyze.unit',
  EXTRACT_UNIT: 'image.plugin.extract.unit',
  RENDER_UNIT: 'image.plugin.render.unit',
} as const

export const Metrics = {
  LOAD_COUNT: 'image.plugin.load.count',
  LOAD_BYTES: 'image.plugin.load.bytes',
  UNIT_COUNT: 'image.plugin.unit.count',
  ANALYZE_UNIT_COUNT: 'image.plugin.analyze.unit.count',
  EXTRACT_UNIT_COUNT: 'image.plugin.extract.unit.count',
  RENDER_UNIT_COUNT: 'image.plugin.render.unit.count',
} as const
