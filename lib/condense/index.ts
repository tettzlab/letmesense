/**
 * Condense Module
 *
 * Map-reduce condensation engine for long markdown documents.
 * Splits text into chunks, summarizes each via LLM, and recursively
 * merges until the output fits a target size.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ChunkStrategy,
  CondenseCost,
  CondenseOptions,
  CondenseProgressEvent,
  CondenseResult,
  CondenseTarget,
  CondenseTokenUsage,
  TextChunk,
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export {
  CHARS_PER_TOKEN_ESTIMATE,
  CONTEXT_WINDOW_INPUT_FRACTION,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RECURSION_DEPTH,
  DEFAULT_OVERLAP_TOKENS,
  MIN_CHUNK_TOKENS,
  PROMPT_OVERHEAD_TOKENS,
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────

export {
  MAP_SYSTEM_PROMPT_HIGH,
  MAP_SYSTEM_PROMPT_LOW,
  MAP_SYSTEM_PROMPT_MEDIUM,
  MAP_USER_PROMPT,
  REDUCE_SYSTEM_PROMPT,
  REDUCE_USER_PROMPT,
  substitutePromptVars,
} from './prompts.js'

// ─────────────────────────────────────────────────────────────────────────────
// Chunking
// ─────────────────────────────────────────────────────────────────────────────

export type { CountTokensFn } from './chunker.js'
export { chunkMarkdown } from './chunker.js'

// ─────────────────────────────────────────────────────────────────────────────
// Core API
// ─────────────────────────────────────────────────────────────────────────────

export { condense } from './condense.js'
