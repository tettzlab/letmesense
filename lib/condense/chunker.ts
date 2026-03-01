/**
 * Markdown-aware text splitting for the condense engine.
 *
 * Splits text into chunks that respect heading structure, paragraph boundaries,
 * and sentence breaks. Each chunk carries heading breadcrumbs for context.
 */

import { obs } from '../observability/index.js'
import { type ChunkStrategy, MIN_CHUNK_TOKENS, type TextChunk } from './types.js'

const { logger } = obs('condense.chunker')

/** Token counting function signature — injected for testability */
export type CountTokensFn = (text: string) => number

/** Regex for ATX headings (# through ######) */
const HEADING_RE = /^(#{1,6})\s+(.+)$/

/** Regex for fenced code block delimiters */
const FENCE_RE = /^(`{3,}|~{3,})/

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split markdown text into chunks respecting structural boundaries.
 *
 * @param text - Full markdown text
 * @param maxTokensPerChunk - Target max tokens per chunk
 * @param strategy - Splitting strategy
 * @param overlapTokens - Tokens of overlap between consecutive chunks
 * @param countTokens - Token counting function
 * @returns Array of text chunks with heading context
 */
export function chunkMarkdown(
  text: string,
  maxTokensPerChunk: number,
  strategy: ChunkStrategy,
  overlapTokens: number,
  countTokens: CountTokensFn,
): TextChunk[] {
  if (!text || text.trim().length === 0) return []

  const rawChunks =
    strategy === 'heading'
      ? chunkByHeading(text, maxTokensPerChunk, countTokens)
      : strategy === 'paragraph'
        ? chunkByParagraph(text, maxTokensPerChunk, countTokens)
        : chunkByTokens(text, maxTokensPerChunk, countTokens)

  if (rawChunks.length === 0) return []

  const result = applyOverlap(rawChunks, overlapTokens, countTokens)

  logger.debug(
    {
      strategy,
      chunkCount: result.length,
      maxTokensPerChunk,
      overlapTokens,
      minTokens: result.length > 0 ? Math.min(...result.map((c) => c.tokenCount)) : 0,
      maxTokens: result.length > 0 ? Math.max(...result.map((c) => c.tokenCount)) : 0,
    },
    'Chunking complete',
  )

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Heading Strategy
// ─────────────────────────────────────────────────────────────────────────────

interface Section {
  heading: string
  level: number
  lines: string[]
  children: Section[]
}

/**
 * Parse markdown into a section tree based on ATX headings.
 * Lines inside fenced code blocks are not treated as headings.
 */
function parseSections(text: string): Section[] {
  const lines = text.split('\n')
  const root: Section[] = []
  const stack: Section[] = []
  let inFence = false

  for (const line of lines) {
    // Track fenced code blocks
    const fenceMatch = line.match(FENCE_RE)
    if (fenceMatch) {
      inFence = !inFence
      appendLineToStack(stack, root, line)
      continue
    }
    if (inFence) {
      appendLineToStack(stack, root, line)
      continue
    }

    const headingMatch = line.match(HEADING_RE)
    if (headingMatch) {
      const level = headingMatch[1].length
      const heading = headingMatch[2].trim()
      const section: Section = { heading, level, lines: [], children: [] }

      // Pop stack until we find a parent with lower level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop()
      }

      if (stack.length === 0) {
        root.push(section)
      } else {
        stack[stack.length - 1].children.push(section)
      }
      stack.push(section)
    } else {
      appendLineToStack(stack, root, line)
    }
  }

  return root
}

function appendLineToStack(stack: Section[], root: Section[], line: string): void {
  if (stack.length > 0) {
    stack[stack.length - 1].lines.push(line)
  } else {
    // Text before any heading — create an implicit root section
    if (root.length === 0 || root[0].heading !== '') {
      root.unshift({ heading: '', level: 0, lines: [], children: [] })
    }
    root[0].lines.push(line)
  }
}

/**
 * Reconstruct full text of a section (without children).
 */
function sectionOwnText(section: Section): string {
  const parts: string[] = []
  if (section.heading) {
    parts.push(`${'#'.repeat(section.level)} ${section.heading}`)
  }
  parts.push(...section.lines)
  return parts.join('\n')
}

/**
 * Reconstruct full text of a section including all descendants.
 */
function sectionFullText(section: Section): string {
  const parts = [sectionOwnText(section)]
  for (const child of section.children) {
    parts.push(sectionFullText(child))
  }
  return parts.join('\n')
}

/**
 * Walk the section tree depth-first, emitting chunks.
 */
function chunkByHeading(text: string, maxTokens: number, countTokens: CountTokensFn): TextChunk[] {
  const sections = parseSections(text)
  const chunks: TextChunk[] = []

  function walk(section: Section, ancestors: string[]): void {
    const context = section.heading ? [...ancestors, section.heading] : ancestors
    const fullText = sectionFullText(section)
    const fullTokens = countTokens(fullText)

    if (fullTokens <= maxTokens) {
      // Entire section fits — emit as single chunk
      chunks.push({
        index: chunks.length,
        text: fullText,
        tokenCount: fullTokens,
        headingContext: context,
      })
      return
    }

    // Section too large — emit own text if non-trivial, then recurse into children
    const ownText = sectionOwnText(section)
    const ownTokens = countTokens(ownText)

    if (section.children.length > 0) {
      // If own text (excluding children) is non-trivial, emit it
      if (ownTokens >= MIN_CHUNK_TOKENS) {
        splitAndEmit(ownText, maxTokens, countTokens, context, chunks)
      } else if (ownText.trim()) {
        // Small preamble — prepend to first child
        const firstChild = section.children[0]
        firstChild.lines.unshift(...ownText.split('\n'))
      }
      for (const child of section.children) {
        walk(child, context)
      }
    } else {
      // Leaf section that's too large — split by paragraph, then sentence
      splitAndEmit(ownText, maxTokens, countTokens, context, chunks)
    }
  }

  for (const section of sections) {
    walk(section, [])
  }

  return chunks
}

/**
 * Split oversized text by paragraphs, then by sentences if needed.
 */
function splitAndEmit(
  text: string,
  maxTokens: number,
  countTokens: CountTokensFn,
  context: string[],
  chunks: TextChunk[],
): void {
  const paragraphs = text.split(/\n\n+/)
  let buffer = ''
  let bufferTokens = 0

  for (const para of paragraphs) {
    const paraTokens = countTokens(para)

    if (bufferTokens + paraTokens <= maxTokens) {
      buffer = buffer ? `${buffer}\n\n${para}` : para
      bufferTokens += paraTokens
    } else {
      // Flush current buffer
      if (buffer) {
        chunks.push({
          index: chunks.length,
          text: buffer,
          tokenCount: bufferTokens,
          headingContext: context,
        })
      }

      // If single paragraph exceeds limit, split by sentences
      if (paraTokens > maxTokens) {
        splitBySentence(para, maxTokens, countTokens, context, chunks)
        buffer = ''
        bufferTokens = 0
      } else {
        buffer = para
        bufferTokens = paraTokens
      }
    }
  }

  if (buffer) {
    chunks.push({
      index: chunks.length,
      text: buffer,
      tokenCount: bufferTokens,
      headingContext: context,
    })
  }
}

/**
 * Last-resort split by sentence boundaries.
 */
function splitBySentence(
  text: string,
  maxTokens: number,
  countTokens: CountTokensFn,
  context: string[],
  chunks: TextChunk[],
): void {
  // Split on sentence-ending punctuation followed by whitespace
  const sentences = text.split(/(?<=[.!?])\s+/)
  let buffer = ''
  let bufferTokens = 0

  for (const sentence of sentences) {
    const sentenceTokens = countTokens(sentence)

    if (bufferTokens + sentenceTokens <= maxTokens) {
      buffer = buffer ? `${buffer} ${sentence}` : sentence
      bufferTokens += sentenceTokens
    } else {
      if (buffer) {
        chunks.push({
          index: chunks.length,
          text: buffer,
          tokenCount: bufferTokens,
          headingContext: context,
        })
      }
      buffer = sentence
      bufferTokens = sentenceTokens
    }
  }

  if (buffer) {
    chunks.push({
      index: chunks.length,
      text: buffer,
      tokenCount: bufferTokens,
      headingContext: context,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paragraph Strategy
// ─────────────────────────────────────────────────────────────────────────────

function chunkByParagraph(
  text: string,
  maxTokens: number,
  countTokens: CountTokensFn,
): TextChunk[] {
  const paragraphs = text.split(/\n\n+/)
  const chunks: TextChunk[] = []
  let buffer = ''
  let bufferTokens = 0

  for (const para of paragraphs) {
    const paraTokens = countTokens(para)

    if (bufferTokens + paraTokens <= maxTokens) {
      buffer = buffer ? `${buffer}\n\n${para}` : para
      bufferTokens += paraTokens
    } else {
      if (buffer) {
        chunks.push({
          index: chunks.length,
          text: buffer,
          tokenCount: bufferTokens,
          headingContext: [],
        })
      }
      buffer = para
      bufferTokens = paraTokens
    }
  }

  if (buffer) {
    chunks.push({
      index: chunks.length,
      text: buffer,
      tokenCount: bufferTokens,
      headingContext: [],
    })
  }

  return chunks
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Strategy
// ─────────────────────────────────────────────────────────────────────────────

function chunkByTokens(text: string, maxTokens: number, countTokens: CountTokensFn): TextChunk[] {
  const words = text.split(/\s+/)
  const chunks: TextChunk[] = []
  let buffer = ''
  let bufferTokens = 0

  for (const word of words) {
    const candidate = buffer ? `${buffer} ${word}` : word
    const candidateTokens = countTokens(candidate)

    if (candidateTokens <= maxTokens) {
      buffer = candidate
      bufferTokens = candidateTokens
    } else {
      if (buffer) {
        chunks.push({
          index: chunks.length,
          text: buffer,
          tokenCount: bufferTokens,
          headingContext: [],
        })
      }
      buffer = word
      bufferTokens = countTokens(word)
    }
  }

  if (buffer) {
    chunks.push({
      index: chunks.length,
      text: buffer,
      tokenCount: bufferTokens,
      headingContext: [],
    })
  }

  return chunks
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prepend overlap text from the end of the previous chunk to each subsequent chunk.
 */
function applyOverlap(
  chunks: TextChunk[],
  overlapTokens: number,
  countTokens: CountTokensFn,
): TextChunk[] {
  if (overlapTokens <= 0 || chunks.length <= 1) return reindex(chunks)

  const result: TextChunk[] = [chunks[0]]

  for (let i = 1; i < chunks.length; i++) {
    const prevText = chunks[i - 1].text
    const overlapText = extractTailByTokens(prevText, overlapTokens, countTokens)

    if (overlapText) {
      const newText = `${overlapText}\n\n${chunks[i].text}`
      result.push({
        ...chunks[i],
        text: newText,
        tokenCount: countTokens(newText),
      })
    } else {
      result.push(chunks[i])
    }
  }

  return reindex(result)
}

/**
 * Extract the last N tokens of text by walking words backward.
 */
function extractTailByTokens(
  text: string,
  targetTokens: number,
  countTokens: CountTokensFn,
): string {
  const words = text.split(/\s+/)
  let tail = ''

  for (let i = words.length - 1; i >= 0; i--) {
    const candidate = tail ? `${words[i]} ${tail}` : words[i]
    if (countTokens(candidate) > targetTokens) break
    tail = candidate
  }

  return tail
}

function reindex(chunks: TextChunk[]): TextChunk[] {
  return chunks.map((c, i) => ({ ...c, index: i }))
}
