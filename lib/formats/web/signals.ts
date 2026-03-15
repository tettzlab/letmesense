/** Web/HTML format plugin span and metric names. */

export const Spans = {
  LOAD: 'web.plugin.load',
  PARSE: 'web.plugin.parse',
  ANALYZE_UNIT: 'web.plugin.analyze.unit',
  EXTRACT_UNIT: 'web.plugin.extract.unit',
  RENDER_UNIT: 'web.plugin.render.unit',
  PLAYWRIGHT_SESSION: 'web.plugin.playwright.session',
} as const

export const Metrics = {
  LOAD_COUNT: 'web.plugin.load.count',
  LOAD_BYTES: 'web.plugin.load.bytes',
  UNIT_COUNT: 'web.plugin.unit.count',
  ANALYZE_UNIT_COUNT: 'web.plugin.analyze.unit.count',
  EXTRACT_UNIT_COUNT: 'web.plugin.extract.unit.count',
  READABILITY_SUCCESS_COUNT: 'web.plugin.readability.success.count',
  READABILITY_FAIL_COUNT: 'web.plugin.readability.fail.count',
  RENDER_UNIT_COUNT: 'web.plugin.render.unit.count',
  RENDER_BYTES: 'web.plugin.render.bytes',
  PLAYWRIGHT_SESSION_COUNT: 'web.plugin.playwright.session.count',
  PLAYWRIGHT_TEXT_CHARS: 'web.plugin.playwright.text.chars',
} as const
