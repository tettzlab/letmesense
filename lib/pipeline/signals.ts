/** Pipeline span and metric names. */

export const Spans = {
  EXTRACT: 'pipeline.extract',
  LOAD: 'pipeline.load',
  PARSE: 'pipeline.parse',
  ANALYZE: 'pipeline.analyze',
  CLASSIFY: 'pipeline.classify',
  EXTRACT_RUNS: 'pipeline.extract.runs',
  URL_RESOLVE: 'pipeline.url.resolve',
  VISION_LOAD: 'pipeline.vision.load',
  VISION_PARSE: 'pipeline.vision.parse',
  VISION_RENDER: 'pipeline.vision.render',
  VISION_EXTRACT: 'pipeline.vision.extract',
} as const

export const Metrics = {
  EXTRACTION_COUNT: 'pipeline.extraction.count',
  RUN_COUNT: 'pipeline.run.count',
  UNIT_COUNT: 'pipeline.unit.count',
  ERROR_COUNT: 'pipeline.error.count',
  EXTRACTION_CHARS: 'pipeline.extraction.chars',
  EXTRACTION_DURATION_MS: 'pipeline.extraction.duration_ms',
  FORMAT_DETECTED_COUNT: 'pipeline.format.detected.count',
  URL_RESOLVE_COUNT: 'pipeline.url.resolve.count',
  URL_RESOLVE_BYTES: 'pipeline.url.resolve.bytes',

  // Vision
  VISION_EXTRACTION_COUNT: 'pipeline.vision.extraction.count',
  VISION_UNIT_COUNT: 'pipeline.vision.unit.count',
  VISION_ERROR_COUNT: 'pipeline.vision.error.count',
  VISION_EXTRACTION_DURATION_MS: 'pipeline.vision.extraction.duration_ms',
  VISION_EXTRACTION_CHARS: 'pipeline.vision.extraction.chars',
  VISION_UNIT_DURATION_MS: 'pipeline.vision.unit.duration_ms',
  VISION_UNIT_CHARS: 'pipeline.vision.unit.chars',

  // Document
  DOCUMENT_COMPLEXITY_SCORE: 'pipeline.document.complexity.score',
  DOCUMENT_PAGE_COUNT: 'pipeline.document.page.count',
} as const
