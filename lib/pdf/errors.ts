/**
 * Error classes for PDF extraction operations.
 * Provides a hierarchy for distinguishing different failure modes.
 */

import { PipelineError, type ProcessingPhase } from '../pipeline/errors.js'

/**
 * Base error class for all PDF extraction operations.
 * Extends PipelineError for unified catch handling.
 */
export class PdfExtractionError extends PipelineError {
  constructor(message: string, cause?: Error, phase?: ProcessingPhase) {
    super(message, phase ?? 'extract', { cause, recoverable: false })
    this.name = 'PdfExtractionError'
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
    super(message, cause, 'parse')
    this.name = 'PdfParseError'
  }
}

/**
 * Error during OCR processing.
 * Covers: Tesseract worker failures, language data issues, recognition errors.
 */
export class PdfOcrError extends PdfExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'ocr')
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
