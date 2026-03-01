/** Image utility span and metric names. */

export const Spans = {
  VIEW: 'image.view',
  ANALYZE: 'image.analyze',
} as const

export const Metrics = {
  ANALYSIS_COUNT: 'image.analysis.count',
  ANALYSIS_DURATION_MS: 'image.analysis.duration_ms',
  LOAD_COUNT: 'image.load.count',
  LOAD_BYTES: 'image.load.bytes',
  PROCESS_DURATION_MS: 'image.process.duration_ms',
  RESIZE_COUNT: 'image.resize.count',
} as const
