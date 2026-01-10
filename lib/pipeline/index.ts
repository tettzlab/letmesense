/**
 * Unified extraction pipeline.
 * Re-exports all public types, classes, and functions.
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Content classification
  ContentKind,
  // Input
  DocumentInput,
  DocumentRun,
  DocumentSource,
  // Document units
  DocumentUnit,
  // Options
  ExtractAllOptions,
  // Extraction
  ExtractedUnit,
  ExtractionMethod,
  ExtractionProvenance,
  ExtractionReliability,
  ExtractionResult,
  ExtractUnitsResult,
  FormatId,
  // Shared
  Lang,
  // Source
  SourceType,
  UnitError,
  UnitExtractionResult,
  // Streaming
  VisionChunk,
  VisionExtractOptions,
} from './types.js'

// ============================================================================
// Errors
// ============================================================================

export {
  AbortError,
  AnalyzeError,
  ConvertError,
  ExtractError,
  FormatError,
  isAbortError,
  isPipelineError,
  isRecoverableError,
  LoadError,
  NotImplementedError,
  OcrError,
  ParseError,
  // Error classes
  PipelineError,
  // Phase type
  type ProcessingPhase,
  RenderError,
  throwIfAborted,
  // Utilities
  wrapError,
} from './errors.js'

// ============================================================================
// Progress
// ============================================================================

export {
  analyzeDone,
  analyzeStart,
  analyzeUnit,
  errorEvent,
  extractDone,
  extractRunDone,
  extractRunStart,
  extractStart,
  extractUnit,
  formatDone,
  formatStart,
  formatUnit,
  loadDone,
  // Event helpers
  loadStart,
  type ProgressCallback,
  // Types
  type ProgressEvent,
  // Reporter class
  ProgressReporter,
  parseDone,
  parseStart,
} from './progress.js'

// ============================================================================
// Plugin
// ============================================================================

export type {
  // CLI
  CliOption,
  // Plugin interface
  FormatPlugin,
  // Document states
  LoadedDocument,
  ParsedDocument,
  // Capabilities
  PluginCapabilities,
  RenderedContent,
} from './plugin.js'

export {
  buildRuns,
  canRender,
  // Utilities
  defaultBuildRunKey,
  supportsOcr,
  supportsVision,
} from './plugin.js'

// ============================================================================
// Registry
// ============================================================================

export {
  describeSource,
  detectFormatFromBytes,
  detectFormatFromExtension,
  detectFormatFromMime,
  // Default registry
  getDefaultRegistry,
  // Detection utilities
  getExtension,
  getPlugin,
  // Registry class
  PluginRegistry,
  registerPlugin,
  resetDefaultRegistry,
} from './registry.js'

// ============================================================================
// Processor
// ============================================================================

export type { ProcessorOptions } from './processor.js'

export {
  // Convenience functions
  extract,
  extractUnits,
  extractWithVision,
  // Processor class
  PipelineProcessor,
} from './processor.js'
