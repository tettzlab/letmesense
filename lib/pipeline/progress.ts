/**
 * Progress tracking for the unified extraction pipeline.
 * Discriminated union pattern for type-safe event handling.
 */

import type { ProcessingPhase } from './errors.js'
import type { FormatId, UnitError } from './types.js'

// ============================================================================
// Progress Events
// ============================================================================

/**
 * Progress events emitted during pipeline execution.
 * Discriminated union on `type` for exhaustive pattern matching.
 */
export type ProgressEvent =
  // Load phase
  | { type: 'load-start'; source: string }
  | { type: 'load-done'; source: string; format: FormatId; byteSize: number }

  // Parse phase
  | { type: 'parse-start'; format: FormatId }
  | { type: 'parse-done'; unitCount: number }

  // Analyze phase
  | { type: 'analyze-start'; unitCount: number }
  | { type: 'analyze-unit'; unitIndex: number; totalUnits: number }
  | { type: 'analyze-done'; unitCount: number }

  // Extract phase
  | { type: 'extract-start'; runCount: number }
  | { type: 'extract-run-start'; runIndex: number; unitCount: number }
  | { type: 'extract-unit'; unitIndex: number; totalUnits: number; charCount: number }
  | { type: 'extract-run-done'; runIndex: number; charCount: number }
  | { type: 'extract-done'; totalChars: number }

  // Format phase (LLM/vision processing)
  | { type: 'format-start'; totalUnits: number }
  | { type: 'format-unit'; unitIndex: number; totalUnits: number; content?: string }
  | { type: 'format-done'; totalUnits: number; totalChars: number }

  // Error (non-fatal, for tracking)
  | { type: 'error'; phase: ProcessingPhase; error: UnitError | Error; unitIndex?: number }

// ============================================================================
// Progress Callback
// ============================================================================

/**
 * Callback function for receiving progress events.
 */
export type ProgressCallback = (event: ProgressEvent) => void

// ============================================================================
// Event Helpers
// ============================================================================

/**
 * Create a load-start event.
 */
export function loadStart(source: string): ProgressEvent {
  return { type: 'load-start', source }
}

/**
 * Create a load-done event.
 */
export function loadDone(source: string, format: FormatId, byteSize: number): ProgressEvent {
  return { type: 'load-done', source, format, byteSize }
}

/**
 * Create a parse-start event.
 */
export function parseStart(format: FormatId): ProgressEvent {
  return { type: 'parse-start', format }
}

/**
 * Create a parse-done event.
 */
export function parseDone(unitCount: number): ProgressEvent {
  return { type: 'parse-done', unitCount }
}

/**
 * Create an analyze-start event.
 */
export function analyzeStart(unitCount: number): ProgressEvent {
  return { type: 'analyze-start', unitCount }
}

/**
 * Create an analyze-unit event.
 */
export function analyzeUnit(unitIndex: number, totalUnits: number): ProgressEvent {
  return { type: 'analyze-unit', unitIndex, totalUnits }
}

/**
 * Create an analyze-done event.
 */
export function analyzeDone(unitCount: number): ProgressEvent {
  return { type: 'analyze-done', unitCount }
}

/**
 * Create an extract-start event.
 */
export function extractStart(runCount: number): ProgressEvent {
  return { type: 'extract-start', runCount }
}

/**
 * Create an extract-run-start event.
 */
export function extractRunStart(runIndex: number, unitCount: number): ProgressEvent {
  return { type: 'extract-run-start', runIndex, unitCount }
}

/**
 * Create an extract-unit event.
 */
export function extractUnit(
  unitIndex: number,
  totalUnits: number,
  charCount: number,
): ProgressEvent {
  return { type: 'extract-unit', unitIndex, totalUnits, charCount }
}

/**
 * Create an extract-run-done event.
 */
export function extractRunDone(runIndex: number, charCount: number): ProgressEvent {
  return { type: 'extract-run-done', runIndex, charCount }
}

/**
 * Create an extract-done event.
 */
export function extractDone(totalChars: number): ProgressEvent {
  return { type: 'extract-done', totalChars }
}

/**
 * Create a format-start event.
 */
export function formatStart(totalUnits: number): ProgressEvent {
  return { type: 'format-start', totalUnits }
}

/**
 * Create a format-unit event.
 */
export function formatUnit(unitIndex: number, totalUnits: number, content?: string): ProgressEvent {
  return { type: 'format-unit', unitIndex, totalUnits, content }
}

/**
 * Create a format-done event.
 */
export function formatDone(totalUnits: number, totalChars: number): ProgressEvent {
  return { type: 'format-done', totalUnits, totalChars }
}

/**
 * Create an error event.
 */
export function errorEvent(
  phase: ProcessingPhase,
  error: UnitError | Error,
  unitIndex?: number,
): ProgressEvent {
  return { type: 'error', phase, error, unitIndex }
}

// ============================================================================
// Progress Reporter
// ============================================================================

/**
 * Helper class for emitting progress events.
 * Handles null callbacks and provides convenience methods.
 */
export class ProgressReporter {
  private callback?: ProgressCallback

  constructor(callback?: ProgressCallback) {
    this.callback = callback
  }

  /** Emit a progress event if callback is set */
  emit(event: ProgressEvent): void {
    this.callback?.(event)
  }

  // Convenience methods for common events
  loadStart(source: string): void {
    this.emit(loadStart(source))
  }

  loadDone(source: string, format: FormatId, byteSize: number): void {
    this.emit(loadDone(source, format, byteSize))
  }

  parseStart(format: FormatId): void {
    this.emit(parseStart(format))
  }

  parseDone(unitCount: number): void {
    this.emit(parseDone(unitCount))
  }

  analyzeStart(unitCount: number): void {
    this.emit(analyzeStart(unitCount))
  }

  analyzeUnit(unitIndex: number, totalUnits: number): void {
    this.emit(analyzeUnit(unitIndex, totalUnits))
  }

  analyzeDone(unitCount: number): void {
    this.emit(analyzeDone(unitCount))
  }

  extractStart(runCount: number): void {
    this.emit(extractStart(runCount))
  }

  extractRunStart(runIndex: number, unitCount: number): void {
    this.emit(extractRunStart(runIndex, unitCount))
  }

  extractUnit(unitIndex: number, totalUnits: number, charCount: number): void {
    this.emit(extractUnit(unitIndex, totalUnits, charCount))
  }

  extractRunDone(runIndex: number, charCount: number): void {
    this.emit(extractRunDone(runIndex, charCount))
  }

  extractDone(totalChars: number): void {
    this.emit(extractDone(totalChars))
  }

  formatStart(totalUnits: number): void {
    this.emit(formatStart(totalUnits))
  }

  formatUnit(unitIndex: number, totalUnits: number, content?: string): void {
    this.emit(formatUnit(unitIndex, totalUnits, content))
  }

  formatDone(totalUnits: number, totalChars: number): void {
    this.emit(formatDone(totalUnits, totalChars))
  }

  error(phase: ProcessingPhase, error: UnitError | Error, unitIndex?: number): void {
    this.emit(errorEvent(phase, error, unitIndex))
  }
}
