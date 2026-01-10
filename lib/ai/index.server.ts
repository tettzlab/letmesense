/**
 * AI Module - Server exports
 *
 * Provides a unified interface for AI model creation and streaming.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { registry, parseModelSpec } from '../lib/ai/index.server.js'
 *
 * // Create model from spec string
 * const model = registry.languageModel('anthropic:sonnet')
 *
 * // Or parse and create separately
 * const spec = parseModelSpec('openai:gpt-5-mini')
 * const model = createModel(spec)
 * ```
 *
 * ## With Retry
 *
 * ```typescript
 * import { streamTextWithRetry, generateTextWithRetry } from '../lib/ai/index.server.js'
 *
 * const result = await streamTextWithRetry({ model, messages })
 * if (result.success) {
 *   // Use result.result (the stream)
 * }
 * ```
 */

// Model creation (requires AI SDK providers)
export { createModel, type LanguageModel } from './createModel.js'
// Re-export all client-safe exports (includes formatCostWarning, buildConfig, detectProvider, resolveProvider)
export * from './index.js'
// Registry facade
export { registry } from './registry.server.js'
// Stream wrappers with retry
export {
  generateTextWithRetry,
  type StreamRetryOptions,
  streamTextWithRetry,
} from './stream.server.js'
// Types commonly needed by server consumers
export type {
  JournalCallback,
  JournalEntry,
  LlmFormatOptions,
  OnProgressCallback,
} from './types.js'
