/**
 * Error classes for Office document extraction operations.
 * Extends the pipeline error hierarchy for unified catch handling.
 */

import { PipelineError, type ProcessingPhase } from '../pipeline/errors.js'

/**
 * Base error class for all Office extraction operations.
 * Extends PipelineError for unified catch handling.
 */
export class OfficeExtractionError extends PipelineError {
  constructor(message: string, cause?: Error, phase?: ProcessingPhase) {
    super(message, phase ?? 'extract', { cause, recoverable: false })
    this.name = 'OfficeExtractionError'
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
