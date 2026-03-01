/**
 * Types and constants for the map-reduce condensation engine.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Tokens of overlap between consecutive chunks */
export const DEFAULT_OVERLAP_TOKENS = 500

/** Max parallel LLM calls during map phase */
export const DEFAULT_CONCURRENCY = 5

/** Safety limit for recursive reduce passes */
export const DEFAULT_MAX_RECURSION_DEPTH = 10

/** Fraction of context window reserved for chunk content (rest is prompt + output) */
export const CONTEXT_WINDOW_INPUT_FRACTION = 0.5

/** Estimated token overhead for system + user prompt framing */
export const PROMPT_OVERHEAD_TOKENS = 500

/** Minimum useful chunk size — below this, merging with neighbors is better */
export const MIN_CHUNK_TOKENS = 2000

/**
 * Rough characters-per-token estimate for quick conversions.
 *
 * Uses 3.0 (lenient) rather than the 3.5 in lib/ai/cost.ts (conservative).
 * Lenient here avoids over-chunking: slightly overestimating token counts
 * produces fewer, larger chunks which is preferable for map-reduce quality.
 * Cost estimation uses 3.5 to avoid underestimating spend.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 3.0

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Target size specification — first defined field wins (priority order). */
export interface CondenseTarget {
  /** Absolute character limit for the output */
  maxChars?: number
  /** Absolute token limit for the output */
  maxTokens?: number
  /** Fractional ratio (0–1) of input to keep */
  ratio?: number
}

/** Strategy for splitting text into chunks */
export type ChunkStrategy = 'heading' | 'paragraph' | 'tokens'

/** Progress event phases */
export type CondenseProgressEvent =
  | { phase: 'start'; totalChars: number; targetTokens: number; targetChars?: number }
  | { phase: 'chunk'; chunkCount: number; strategy: ChunkStrategy }
  | { phase: 'map'; chunkIndex: number; totalChunks: number }
  | { phase: 'map-done'; summaryTokens: number }
  | { phase: 'reduce'; depth: number; inputTokens: number }
  | { phase: 'reduce-done'; depth: number; outputTokens: number }
  | { phase: 'done'; ratio: number }

/** Options for the condense engine */
export interface CondenseOptions {
  /** Target output size */
  target: CondenseTarget
  /** Model spec string (e.g., "openai:mini") — auto-detected if omitted */
  model?: string
  /** Path to a models.json file (default: bundled) */
  modelsFile?: string
  /** Raw JSON string for the model registry (overrides modelsFile) */
  modelsJson?: string
  /** Chunking strategy (default: 'heading') */
  chunkStrategy?: ChunkStrategy
  /** Max tokens per chunk (auto-calculated from model context if omitted) */
  maxChunkTokens?: number
  /** Overlap tokens between chunks */
  overlapTokens?: number
  /** Max parallel map calls */
  concurrency?: number
  /** Max recursive reduce passes */
  maxRecursionDepth?: number
  /** Custom map system prompt (replaces default) */
  mapSystemPrompt?: string
  /** Custom map user prompt template (replaces default) */
  mapUserPrompt?: string
  /** Custom reduce system prompt (replaces default) */
  reduceSystemPrompt?: string
  /** Custom reduce user prompt template (replaces default) */
  reduceUserPrompt?: string
  /** Retry options for LLM calls */
  retry?: { maxRetries?: number; initialDelayMs?: number }
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Progress callback */
  onProgress?: (event: CondenseProgressEvent) => void
}

/** Token usage breakdown */
export interface CondenseTokenUsage {
  inputTokens: number
  outputTokens: number
  mapCalls: number
  reduceCalls: number
  reduceDepth: number
}

/** Cost breakdown in USD */
export interface CondenseCost {
  total: number
  map: number
  reduce: number
}

/** Result of a condense operation */
export interface CondenseResult {
  /** Condensed text */
  text: string
  /** Input character count */
  inputChars: number
  /** Output character count */
  outputChars: number
  /** Compression ratio (output / input) */
  ratio: number
  /** Token usage across all LLM calls */
  usage: CondenseTokenUsage
  /** Cost breakdown */
  cost: CondenseCost
  /** Model ID used */
  model: string
  /** Provider used */
  provider: string
  /** True if input already fit the target (no LLM calls made) */
  passthrough: boolean
}

/** Internal representation of a text chunk */
export interface TextChunk {
  /** Chunk index (0-based) */
  index: number
  /** Chunk text content */
  text: string
  /** Token count of this chunk */
  tokenCount: number
  /** Ancestor heading breadcrumbs */
  headingContext: string[]
}
