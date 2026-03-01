/** Office utility span and metric names. */

export const Spans = {
  LOAD_DOCUMENT: 'office.load.document',
  PARSE_FILE: 'office.parse.file',
  PARSE_BUFFER: 'office.parse.buffer',
  TEXT_EXTRACT: 'office.text.extract',
  EXTRACT: 'office.extract',
  LOAD: 'office.load',
  PARSE: 'office.parse',
  ANALYZE: 'office.analyze',

  // LibreOffice
  LIBREOFFICE_CONVERT: 'office.libreoffice.convert',
  LIBREOFFICE_CONVERT_WITH_PROFILE: 'office.libreoffice.convert.with.profile',

  // Vision
  VISION_CONVERT_TO_PDF: 'office.vision.convert.to.pdf',
  VISION_RENDER_TO_IMAGES: 'office.vision.render.to.images',
  VISION_FORMAT: 'office.vision.format',
} as const

export const Metrics = {
  DOCUMENT_LOADED_COUNT: 'office.document.loaded.count',
  DOCUMENT_BYTES: 'office.document.bytes',
  DOCUMENT_PARSED_COUNT: 'office.document.parsed.count',
  CLASSIFICATION_COUNT: 'office.classification.count',
  CLASSIFICATION_COVERAGE_COUNT: 'office.classification.coverage.count',
  TEXT_EXTRACT_COUNT: 'office.text.extract.count',
  TEXT_EXTRACT_DURATION_MS: 'office.text.extract.duration_ms',
  FORMAT_COUNT: 'office.format.count',
  FORMAT_DURATION_MS: 'office.format.duration_ms',
  EXTRACTION_COUNT: 'office.extraction.count',
  EXTRACTION_DURATION_MS: 'office.extraction.duration_ms',
  UNIT_COUNT: 'office.unit.count',

  // LibreOffice
  LIBREOFFICE_CONVERSION_COUNT: 'office.libreoffice.conversion.count',
  LIBREOFFICE_CONVERSION_PROFILE_COUNT: 'office.libreoffice.conversion.profile.count',
  LIBREOFFICE_DURATION_MS: 'office.libreoffice.duration_ms',

  // LibreOffice Pool
  LIBREOFFICE_POOL_ACTIVE: 'office.libreoffice.pool.active',
  LIBREOFFICE_POOL_QUEUE_DEPTH: 'office.libreoffice.pool.queue.depth',
  LIBREOFFICE_POOL_JOB_COUNT: 'office.libreoffice.pool.job.count',
  LIBREOFFICE_POOL_JOB_DURATION_MS: 'office.libreoffice.pool.job.duration_ms',

  // Vision
  VISION_RENDER_COUNT: 'office.vision.render.count',
  VISION_RENDER_DURATION_MS: 'office.vision.render.duration_ms',
  VISION_PROCESS_COUNT: 'office.vision.process.count',
  VISION_PROCESS_DURATION_MS: 'office.vision.process.duration_ms',
} as const
