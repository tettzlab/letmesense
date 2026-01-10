/**
 * Token Counter - Model-specific token counting using appropriate tokenizers.
 *
 * Uses the model's encoding from MODEL_REGISTRY to select the correct tokenizer.
 * Tokenizers are lazy-loaded and cached for performance.
 */

import { fromPreTrained as claudeTokenizer } from '@lenml/tokenizer-claude'
import { fromPreTrained as geminiTokenizer } from '@lenml/tokenizer-gemini'
import { encode as gptEncode } from 'gpt-tokenizer'
import { encode as cl100kEncode } from 'gpt-tokenizer/encoding/cl100k_base'
import llama3Tokenizer from 'llama3-tokenizer-js'
import { getDefaultEncoding, getModel, type ProviderId, type TokenizerEncoding } from './models.js'

/** Per-message token overhead (role, structure, special tokens) */
export const MSG_TOKEN_OVERHEAD = 4

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-loaded Encoders
// ─────────────────────────────────────────────────────────────────────────────

type ClaudeEncoder = ReturnType<typeof claudeTokenizer>
type GeminiEncoder = ReturnType<typeof geminiTokenizer>

let claudeEnc: ClaudeEncoder | null = null
let geminiEnc: GeminiEncoder | null = null

function getClaudeEncoder(): ClaudeEncoder {
  if (!claudeEnc) claudeEnc = claudeTokenizer()
  return claudeEnc
}

function getGeminiEncoder(): GeminiEncoder {
  if (!geminiEnc) geminiEnc = geminiTokenizer()
  return geminiEnc
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Counting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count tokens using encoding-specific tokenizer.
 */
export function countTokensWithEncoding(text: string, encoding: TokenizerEncoding): number {
  if (!text) return 0

  switch (encoding) {
    case 'cl100k_base':
      return cl100kEncode(text).length

    case 'o200k_base':
      return gptEncode(text).length

    case 'claude':
      return getClaudeEncoder().encode(text).length

    case 'gemini':
      return getGeminiEncoder().encode(text).length

    case 'llama3':
    case 'qwen2':
      // Qwen uses similar tokenization to Llama3
      return llama3Tokenizer.encode(text).length

    default:
      // Fallback to GPT tokenizer
      return gptEncode(text).length
  }
}

/**
 * Count tokens for a specific model.
 * Looks up the model's encoding from MODEL_REGISTRY.
 */
export function countTokens(text: string, modelId: string): number {
  const model = getModel(modelId)
  const encoding = model?.encoding ?? getDefaultEncoding('openai')
  return countTokensWithEncoding(text, encoding)
}

/**
 * Count tokens using provider's default encoding.
 * Use when model ID is not available.
 */
export function countTokensByProvider(text: string, provider: ProviderId): number {
  const encoding = getDefaultEncoding(provider)
  return countTokensWithEncoding(text, encoding)
}
