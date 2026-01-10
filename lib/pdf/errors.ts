/**
 * Error classes for PDF extraction operations.
 * Provides a hierarchy for distinguishing different failure modes.
 */

/** Phase of PDF processing where error occurred */
export type PdfErrorPhase = 'load' | 'split' | 'extract'

/**
 * Base error class for all PDF extraction operations.
 * All PDF-related errors extend this class for easy catching.
 */
export class PdfExtractionError extends Error {
  /** Phase of processing where error occurred (for CLI compatibility) */
  public readonly phase?: PdfErrorPhase

  constructor(
    message: string,
    public readonly cause?: Error,
    phase?: PdfErrorPhase,
  ) {
    super(message)
    this.name = 'PdfExtractionError'
    this.phase = phase
  }
}

/**
 * Error during PDF loading phase.
 * Covers: file read errors, URL fetch failures, invalid input types.
 */
export class PdfLoadError extends PdfExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'load')
    this.name = 'PdfLoadError'
  }
}

/**
 * Error during PDF parsing or structure analysis.
 * Covers: corrupted PDFs, unsupported PDF features, malformed content.
 */
export class PdfParseError extends PdfExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'load')
    this.name = 'PdfParseError'
  }
}

/**
 * Error during OCR processing.
 * Covers: Tesseract worker failures, language data issues, recognition errors.
 */
export class PdfOcrError extends PdfExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'extract')
    this.name = 'PdfOcrError'
  }
}

/**
 * Error during PDF splitting into runs.
 * Covers: page analysis failures, run grouping issues.
 */
export class PdfSplitError extends PdfExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'split')
    this.name = 'PdfSplitError'
  }
}

/**
 * Error during text extraction from a run.
 * Covers: digital text extraction failures, mixed mode issues.
 */
export class PdfExtractError extends PdfExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'extract')
    this.name = 'PdfExtractError'
  }
}
