/**
 * Error classes for Office document extraction operations.
 * Mirrors the letmesense error hierarchy for consistency.
 */

/** Phase of Office processing where error occurred */
export type OfficeErrorPhase = 'load' | 'parse' | 'analyze' | 'extract' | 'convert' | 'vision'

/**
 * Base error class for all Office extraction operations.
 * All Office-related errors extend this class for easy catching.
 */
export class OfficeExtractionError extends Error {
  /** Phase of processing where error occurred */
  public readonly phase?: OfficeErrorPhase

  constructor(
    message: string,
    public readonly cause?: Error,
    phase?: OfficeErrorPhase,
  ) {
    super(message)
    this.name = 'OfficeExtractionError'
    this.phase = phase

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * Error during Office document loading phase.
 * Covers: file read errors, URL fetch failures, invalid input types.
 */
export class OfficeLoadError extends OfficeExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'load')
    this.name = 'OfficeLoadError'
  }
}

/**
 * Error during Office document parsing.
 * Covers: corrupted files, unsupported formats, malformed content.
 */
export class OfficeParseError extends OfficeExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'parse')
    this.name = 'OfficeParseError'
  }
}

/**
 * Error during content analysis.
 * Covers: content classification failures, language detection issues.
 */
export class OfficeAnalyzeError extends OfficeExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'analyze')
    this.name = 'OfficeAnalyzeError'
  }
}

/**
 * Error during text extraction.
 * Covers: text extraction failures, formatting issues.
 */
export class OfficeExtractError extends OfficeExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'extract')
    this.name = 'OfficeExtractError'
  }
}

/**
 * Error during PDF conversion (LibreOffice).
 * Covers: LibreOffice not installed, conversion failures, timeouts.
 */
export class OfficeConvertError extends OfficeExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'convert')
    this.name = 'OfficeConvertError'
  }
}

/**
 * Error during vision processing.
 * Covers: rendering failures, LLM API errors.
 */
export class OfficeVisionError extends OfficeExtractionError {
  constructor(message: string, cause?: Error) {
    super(message, cause, 'vision')
    this.name = 'OfficeVisionError'
  }
}

/**
 * Get helpful installation instructions for LibreOffice.
 */
export function getLibreOfficeInstallInstructions(): string {
  const platform = process.platform

  switch (platform) {
    case 'darwin':
      return `LibreOffice is required for --vision mode.

Install on macOS:
  brew install --cask libreoffice

Or download from: https://www.libreoffice.org/download/`

    case 'linux':
      return `LibreOffice is required for --vision mode.

Install on Ubuntu/Debian:
  sudo apt-get install libreoffice-core libreoffice-impress libreoffice-writer libreoffice-calc

Install on Fedora:
  sudo dnf install libreoffice-core libreoffice-impress libreoffice-writer libreoffice-calc

Install on Arch:
  sudo pacman -S libreoffice-fresh`

    case 'win32':
      return `LibreOffice is required for --vision mode.

Install on Windows:
  Download from: https://www.libreoffice.org/download/
  Or use: choco install libreoffice-fresh`

    default:
      return `LibreOffice is required for --vision mode.
Download from: https://www.libreoffice.org/download/`
  }
}
