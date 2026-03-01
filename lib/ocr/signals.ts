/** OCR span and metric names. */

export const Spans = {
  WORKER_CREATE: 'ocr.worker.create',
  RECOGNIZE: 'ocr.recognize',
  RECOGNIZE_WITH_WORKER: 'ocr.recognize.with.worker',
} as const

export const Metrics = {
  RECOGNITION_COUNT: 'ocr.recognition.count',
  CONFIDENCE_SCORE: 'ocr.confidence.score',
  WORKER_CREATED_COUNT: 'ocr.worker.created.count',
  WORKER_TERMINATED_COUNT: 'ocr.worker.terminated.count',
  TESSDATA_LOAD_COUNT: 'ocr.tessdata.load.count',
} as const
