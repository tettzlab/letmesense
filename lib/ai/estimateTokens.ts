/**
 * Lightweight token estimator for encodings without an official open-source tokenizer.
 *
 * Uses character-class heuristics instead of real BPE — no third-party vocab data needed.
 * Accuracy is within ~10-15% of actual BPE counts, which is sufficient for chunking
 * and cost estimation (actual usage comes from the API response).
 *
 * Tuned against measured averages:
 *   - Claude (Anthropic): ~3.4 chars/token for Latin, ~1.5 for CJK
 *   - Gemini (Google):    ~3.8 chars/token for Latin, ~1.5 for CJK
 */

// Regex: CJK Unified Ideographs + Hiragana + Katakana + Hangul
const CJK_RE = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g

/** Chars-per-token ratios */
const RATIOS = {
  claude: { latin: 3.4, cjk: 1.5 },
  gemini: { latin: 3.8, cjk: 1.5 },
} as const

export type EstimableEncoding = keyof typeof RATIOS

export function isEstimable(encoding: string): encoding is EstimableEncoding {
  return encoding in RATIOS
}

/**
 * Estimate token count using character-class ratios.
 * Splits text into CJK and non-CJK segments, counts each with its own ratio,
 * then sums. Adds 1 token for the BOS/special-token overhead.
 */
export function estimateTokens(text: string, encoding: EstimableEncoding): number {
  if (!text) return 0

  const { latin, cjk } = RATIOS[encoding]

  const cjkChars = text.match(CJK_RE)
  const cjkCount = cjkChars?.length ?? 0
  const latinCount = text.length - cjkCount

  return Math.ceil(latinCount / latin + cjkCount / cjk) + 1
}
