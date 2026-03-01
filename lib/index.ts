/**
 * letmesense - Document text extraction library
 *
 * High-level API for extracting text from documents (PDF, Office, Images).
 * Supports OCR for scanned documents and LLM-enhanced formatting.
 *
 * @example
 * ```ts
 * import { sense, senseStream, estimateCost } from 'letmesense'
 *
 * // Basic extraction
 * const result = await sense('document.pdf')
 * console.log(result.text)
 *
 * // With LLM formatting
 * const formatted = await sense('document.pdf', { llm: true })
 *
 * // Vision mode with streaming
 * for await (const chunk of senseStream('slides.pptx', { vision: true })) {
 *   if (chunk.type === 'content') process.stdout.write(chunk.content)
 * }
 *
 * // Estimate cost before processing
 * const estimate = await estimateCost('large.pdf', { vision: true })
 * console.log(`Estimated: $${estimate.cost.total.toFixed(4)}`)
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Main API
// ============================================================================

export {
  // Result types
  type CostInfo,
  estimateCost,
  // Option types
  type LlmOptions,
  type SenseChunk,
  type SenseOptions,
  type SenseResult,
  // Main functions
  sense,
  senseStream,
  type VisionOptions,
} from './sense/index.js'

// ============================================================================
// Re-exports from pipeline
// ============================================================================

export type {
  // Core types
  ContentKind,
  DocumentInput,
  DocumentRun,
  DocumentUnit,
  ExtractedUnit,
  ExtractionResult,
  ExtractUnitsResult,
  FormatId,
  // Plugin types (for advanced usage)
  FormatPlugin,
  Lang,
  PluginCapabilities,
  ProcessorOptions,
  // Progress
  ProgressCallback,
  ProgressEvent,
  UnitError,
  VisionChunk,
  VisionExtractOptions,
} from './pipeline/index.js'

export {
  // Error classes
  AbortError,
  AnalyzeError,
  ConvertError,
  ExtractError,
  // Low-level extraction functions (for advanced usage)
  extract,
  extractUnits,
  extractWithVision,
  FormatError,
  // Registry (for plugin development)
  getDefaultRegistry,
  // Error utilities
  isAbortError,
  isPipelineError,
  isRecoverableError,
  LoadError,
  NotImplementedError,
  OcrError,
  ParseError,
  PipelineError,
  // Processor (for advanced usage)
  PipelineProcessor,
  PluginRegistry,
  type ProcessingPhase,
  RenderError,
  registerPlugin,
} from './pipeline/index.js'

// ============================================================================
// Re-exports from AI
// ============================================================================

export type { PromptPreset } from './ai/prompts.js'
export type {
  CostBreakdown,
  CostEstimate,
  // AI types
  JournalCallback,
  JournalEntry,
  LlmConfig,
  OnProgressCallback,
  ProviderId,
  StreamEvent,
  TokenUsage,
} from './ai/types.js'
