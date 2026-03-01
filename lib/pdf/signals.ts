/** PDF utility span and metric names. */

export const Spans = {
  LOAD_DOCUMENT: 'pdf.load.document',
  ANALYZE_PAGE: 'pdf.analyze.page',
  RENDER_PAGE: 'pdf.render.page',
  RENDER_ALL_PAGES: 'pdf.render.all.pages',
  SPLIT: 'pdf.split',
  OCR: 'pdf.ocr',
  EXTRACT: 'pdf.extract',
} as const

export const Metrics = {
  DOCUMENT_LOAD_COUNT: 'pdf.document.load.count',
  DOCUMENT_BYTES: 'pdf.document.bytes',
  PAGE_ANALYZED_COUNT: 'pdf.page.analyzed.count',
  PAGE_RENDER_COUNT: 'pdf.page.render.count',
  RENDER_BYTES: 'pdf.render.bytes',
  RENDER_ALL_BYTES: 'pdf.render.all.bytes',
  CLASSIFICATION_COUNT: 'pdf.classification.count',
  TEXT_EXTRACT_DURATION_MS: 'pdf.text.extract.duration_ms',
  EXTRACTION_COUNT: 'pdf.extraction.count',
  EXTRACTION_DURATION_MS: 'pdf.extraction.duration_ms',
  PAGE_COUNT: 'pdf.page.count',
  OCR_PAGE_COUNT: 'pdf.ocr.page.count',
} as const
