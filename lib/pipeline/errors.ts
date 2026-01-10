/**
 * Error classes for the unified extraction pipeline.
 * Provides a hierarchy for distinguishing different failure modes.
 */

// ============================================================================
// Processing Phases
// ============================================================================

/** Phase of pipeline processing where error occurred */
export type ProcessingPhase =
  | 'load' // Loading document from source
  | 'parse' // Parsing document structure
  | 'analyze' // Analyzing content units
  | 'extract' // Extracting text content
  | 'render' // Rendering pages to images
  | 'ocr' // OCR processing
  | 'format' // Output formatting
  | 'convert' // Format conversion (e.g., Office → PDF)

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base error class for all pipeline operations.
 * All pipeline-related errors extend this class for easy catching.
 */
export class PipelineError extends Error {
  /** Phase of processing where error occurred */
  public readonly phase: ProcessingPhase

  /** Original error that caused this error */
  public readonly cause?: Error

  /** Whether this error is potentially recoverable */
  public readonly recoverable: boolean

  constructor(
    message: string,
    phase: ProcessingPhase,
    options?: { cause?: Error; recoverable?: boolean },
  ) {
    super(message)
    this.name = 'PipelineError'
    this.phase = phase
    this.cause = options?.cause
    this.recoverable = options?.recoverable ?? false
  }
}

// ============================================================================
// Phase-Specific Errors
// ============================================================================

/**
 * Error during document loading phase.
 * Covers: file read errors, URL fetch failures, invalid input types.
 */
export class LoadError extends PipelineError {
  constructor(message: string, cause?: Error) {
    super(message, 'load', { cause, recoverable: false })
    this.name = 'LoadError'
  }
}

/**
 * Error during document parsing phase.
 * Covers: corrupted documents, unsupported features, malformed content.
 */
export class ParseError extends PipelineError {
  constructor(message: string, cause?: Error) {
    super(message, 'parse', { cause, recoverable: false })
    this.name = 'ParseError'
  }
}

/**
 * Error during content analysis phase.
 * Covers: unit analysis failures, classification errors.
 */
export class AnalyzeError extends PipelineError {
  constructor(message: string, cause?: Error) {
    super(message, 'analyze', { cause, recoverable: true })
    this.name = 'AnalyzeError'
  }
}

/**
 * Error during text extraction phase.
 * Covers: digital text extraction failures, encoding issues.
 */
export class ExtractError extends PipelineError {
  constructor(message: string, cause?: Error) {
    super(message, 'extract', { cause, recoverable: true })
    this.name = 'ExtractError'
  }
}

/**
 * Error during page rendering phase.
 * Covers: canvas failures, memory issues during rendering.
 */
export class RenderError extends PipelineError {
  constructor(message: string, cause?: Error) {
    super(message, 'render', { cause, recoverable: true })
    this.name = 'RenderError'
  }
}

/**
 * Error during OCR processing phase.
 * Covers: Tesseract worker failures, language data issues.
 */
export class OcrError extends PipelineError {
  constructor(message: string, cause?: Error) {
    super(message, 'ocr', { cause, recoverable: true })
    this.name = 'OcrError'
  }
}

/**
 * Error during output formatting phase.
 * Covers: template errors, serialization failures.
 */
export class FormatError extends PipelineError {
  constructor(message: string, cause?: Error) {
    super(message, 'format', { cause, recoverable: false })
    this.name = 'FormatError'
  }
}

/**
 * Error during format conversion phase.
 * Covers: LibreOffice conversion failures, unsupported formats.
 */
export class ConvertError extends PipelineError {
  constructor(message: string, cause?: Error) {
    super(message, 'convert', { cause, recoverable: false })
    this.name = 'ConvertError'
  }
}

/**
 * Error for features that are not yet implemented.
 * Used for placeholder code that will be completed in later phases.
 */
export class NotImplementedError extends PipelineError {
  constructor(feature: string, phase: ProcessingPhase = 'format') {
    super(`Not implemented: ${feature}`, phase, { recoverable: false })
    this.name = 'NotImplementedError'
  }
}

/**
 * Error thrown when an operation is aborted via AbortSignal.
 */
export class AbortError extends PipelineError {
  constructor(phase: ProcessingPhase = 'extract') {
    super('Operation aborted', phase, { recoverable: false })
    this.name = 'AbortError'
  }
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Wrap an unknown error into a PipelineError.
 * Preserves original PipelineError instances.
 */
export function wrapError(error: unknown, phase: ProcessingPhase, message?: string): PipelineError {
  if (error instanceof PipelineError) {
    return error
  }

  const cause = error instanceof Error ? error : new Error(String(error))
  const errorMessage = message ?? cause.message

  switch (phase) {
    case 'load':
      return new LoadError(errorMessage, cause)
    case 'parse':
      return new ParseError(errorMessage, cause)
    case 'analyze':
      return new AnalyzeError(errorMessage, cause)
    case 'extract':
      return new ExtractError(errorMessage, cause)
    case 'render':
      return new RenderError(errorMessage, cause)
    case 'ocr':
      return new OcrError(errorMessage, cause)
    case 'format':
      return new FormatError(errorMessage, cause)
    case 'convert':
      return new ConvertError(errorMessage, cause)
    default:
      return new PipelineError(errorMessage, phase, { cause })
  }
}

/**
 * Check if an error is a PipelineError.
 */
export function isPipelineError(error: unknown): error is PipelineError {
  return error instanceof PipelineError
}

/**
 * Check if an error is recoverable (processing can continue).
 */
export function isRecoverableError(error: unknown): boolean {
  return error instanceof PipelineError && error.recoverable
}

/**
 * Check if an error is an AbortError.
 */
export function isAbortError(error: unknown): error is AbortError {
  return error instanceof AbortError
}

/**
 * Throw AbortError if the signal has been aborted.
 * Call this at checkpoints in long-running operations.
 */
export function throwIfAborted(signal: AbortSignal | undefined, phase: ProcessingPhase): void {
  if (signal?.aborted) {
    throw new AbortError(phase)
  }
}
