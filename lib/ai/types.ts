/**
 * Domain-specific LLM types (journaling, formatting, streaming)
 *
 * Provider-agnostic types (LlmProvider, LlmConfig, etc.) are defined in ~/lib/ai/config.ts
 * Domain-specific context types (PageContext, etc.) are defined in ~/lib/pipeline/types.ts
 */

// Re-export context types from pipeline (canonical location)
export type {
  ImageContext,
  JournalContext,
  OfficeUnitContext,
  PageContext,
} from '../pipeline/types.js'
// Re-export provider types from central config
export type {
  CostBreakdown,
  CostEstimate,
  DetectedProvider,
  FormatRequest,
  FormatResponse,
  LlmConfig,
  LlmProvider,
  ModelPricing,
  ProviderId,
  TokenInputDetails,
  TokenOutputDetails,
  TokenUsage,
} from './config.js'

// Import locally for use in JournalEntry
import type { JournalContext } from '../pipeline/types.js'

// ============================================================================
// Formatting Types
// ============================================================================

/** Output format options */
export type OutputFormat = 'text' | 'markdown'

/** Stream events emitted during formatting */
export type StreamEvent =
  | { type: 'start'; totalPages: number; estimatedCost: import('./config.js').CostEstimate }
  | { type: 'page-start'; pageIndex: number }
  | { type: 'content'; content: string; pageIndex: number }
  | { type: 'page-done'; pageIndex: number }
  | { type: 'error'; error: Error; pageIndex?: number }
  | { type: 'done'; totalPages: number }

/** Progress callback for streaming */
export type OnProgressCallback = (event: StreamEvent) => void

/** Options for markdown formatting */
export interface LlmFormatOptions {
  /** Output format */
  format: OutputFormat
  /** Enable vision mode (send images to LLM) */
  vision?: boolean
  /** LLM configuration */
  llm?: Partial<import('./config.js').LlmConfig>
  /** Custom prompt template */
  promptTemplate?: string
  /** Custom system prompt (prepended to default) */
  systemPrompt?: string
  /** Additional template variables */
  promptVariables?: Record<string, string>
  /** Suppress cost warnings and confirmation */
  quiet?: boolean
  /** Progress callback for streaming */
  onProgress?: OnProgressCallback
  /** Custom page separator (defaults to '\n\n---\n\n') */
  pageSeparator?: string
  /** Experiment name for journaling */
  experiment?: string
  /** Journal callback for logging LLM calls */
  onJournal?: JournalCallback
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

// ============================================================================
// Experiment Journaling Types
// ============================================================================

/** Journal entry for an LLM call */
export interface JournalEntry {
  /** Unique identifier (timestamp + random suffix) */
  id: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Experiment name */
  experiment: string

  // Request details
  /** Provider name */
  provider: string
  /** Model ID */
  model: string
  /** Original prompt template (before substitution) */
  promptTemplate: string
  /** Substituted prompt (after variable replacement) */
  prompt: string
  /** Input content info */
  input: {
    text?: string
    hasImage: boolean
    hasPdf: boolean
  }
  /** Context (page, office unit, or image) */
  context: JournalContext

  // Response details
  /** LLM output */
  output: string
  /** Reason the model stopped generating (stop, length, content_filter, etc.) */
  finishReason?: string
  /** Raw response metadata for debugging */
  rawMeta?: Record<string, unknown>

  // Metrics
  /** Token usage (enhanced with detailed breakdown) */
  tokens: {
    input: number
    output: number
    total?: number

    /** Input token breakdown (optional, provider-dependent) */
    inputDetails?: {
      cached?: number
      cacheCreation?: number
      uncached?: number
    }

    /** Output token breakdown (optional, provider-dependent) */
    outputDetails?: {
      text?: number
      reasoning?: number
    }
  }

  /** Cost breakdown in USD */
  cost: {
    total: number
    input?: number
    output?: number
    cached?: number
    reasoning?: number
  }

  /** Duration of LLM call in milliseconds */
  durationMs: number

  // Error handling
  /** Number of retries (if any) */
  retries?: number
  /** Error message (if failed) */
  error?: string

  /** Relative path to saved input image (if saved) */
  imagePath?: string
}

/** Callback for journal entries */
export type JournalCallback = (entry: JournalEntry) => void | Promise<void>
