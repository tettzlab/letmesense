/**
 * Types for the shared OCR module.
 */

/**
 * Options for OCR operations.
 */
export interface OcrOptions {
  /** OCR language(s): "eng" or "eng+jpn" */
  lang: string

  /** Directory containing .traineddata.gz files for offline OCR */
  tessdataDir?: string

  /** Per-image timeout in milliseconds. Default: 60000 */
  timeout?: number

  /** Whether to detect page orientation. Default: false */
  detectOrientation?: boolean
}

/**
 * Result from OCR processing.
 */
export interface OcrResult {
  /** Extracted text */
  text: string

  /** OCR confidence score (0-100) */
  confidence: number
}

/**
 * Extended result including orientation info.
 */
export interface OcrResultWithOrientation extends OcrResult {
  /** Detected page orientation (degrees clockwise) */
  orientation?: number

  /** Detected script (e.g., "Latin", "Han") */
  script?: string
}
