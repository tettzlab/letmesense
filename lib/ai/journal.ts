/**
 * Experiment journaling for LLM prompt iteration and fine-tuning workflows.
 *
 * Supports both JSONL (machine-readable) and Markdown (human-readable) formats.
 */

import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CostBreakdown, ModelPricing, TokenUsage } from './config.js'
import type { JournalCallback, JournalContext, JournalEntry } from './types.js'

/** Supported journal output formats */
export type JournalFormat = 'jsonl' | 'markdown'

/** Parameters for creating a journal entry with optional image data */
export interface CreateJournalEntryParams {
  experiment: string
  provider: string
  model: string
  promptTemplate: string
  prompt: string
  context: JournalContext
  hasImage: boolean
  hasPdf: boolean
  output: string
  tokens: TokenUsage
  cost: CostBreakdown
  durationMs: number
  retries?: number
  error?: string
  finishReason?: string
  rawMeta?: Record<string, unknown>
  /** Image data for saving (base64 string or Buffer) */
  imageData?: string | Buffer
  /** MIME type of the image (e.g., 'image/png') */
  imageMimeType?: string
}

/** Threshold for collapsible content (characters) */
const COLLAPSIBLE_THRESHOLD = 500

/**
 * Temporary storage for image data pending save.
 * WeakMap ensures entries are garbage collected after processing.
 */
const pendingImageData = new WeakMap<JournalEntry, { data: string | Buffer; mimeType: string }>()

/**
 * Generate a unique entry ID (timestamp + random suffix).
 *
 * Format: YYYYMMDD-HHmmss-xxxxxxxx
 * Example: 20240115-143052-a7f3b2c1
 */
export function generateEntryId(): string {
  const now = new Date()
  const datePart = now
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, '')
    .replace(/(\d{8})(\d{6})/, '$1-$2')
  const randomPart = randomBytes(4).toString('hex')
  return `${datePart}-${randomPart}`
}

/**
 * Calculate cost from token usage and pricing.
 * Returns a detailed cost breakdown.
 *
 * Note: Cached tokens typically have a discount (e.g., 90% off for Anthropic).
 * For simplicity, we calculate cached cost at 10% of normal input price.
 */
export function calculateEntryCost(tokens: TokenUsage, pricing: ModelPricing): CostBreakdown {
  const { inputTokens, outputTokens, inputDetails, outputDetails } = tokens

  // Calculate input costs
  let inputCost = 0
  let cachedCost: number | undefined

  if (inputDetails?.cached) {
    // Cached tokens are typically discounted (use 10% of input price)
    const cachedDiscount = 0.1
    cachedCost = (inputDetails.cached / 1_000_000) * pricing.input * cachedDiscount
    // Non-cached input tokens
    const uncachedTokens = inputDetails.uncached ?? inputTokens - inputDetails.cached
    inputCost = (uncachedTokens / 1_000_000) * pricing.input
  } else {
    inputCost = (inputTokens / 1_000_000) * pricing.input
  }

  // Calculate output costs
  let outputCost = 0
  let reasoningCost: number | undefined

  if (outputDetails?.reasoning) {
    // Reasoning tokens may have different pricing (for now, same as output)
    reasoningCost = (outputDetails.reasoning / 1_000_000) * pricing.output
    const textTokens = outputDetails.text ?? outputTokens - outputDetails.reasoning
    outputCost = (textTokens / 1_000_000) * pricing.output
  } else {
    outputCost = (outputTokens / 1_000_000) * pricing.output
  }

  const totalCost = inputCost + outputCost + (cachedCost ?? 0) + (reasoningCost ?? 0)

  return {
    total: totalCost,
    input: inputCost,
    output: outputCost,
    cached: cachedCost,
    reasoning: reasoningCost,
  }
}

/**
 * Save journal image to disk and return relative path.
 *
 * @param dir - Directory for journal files
 * @param experiment - Experiment name (sanitized for filename)
 * @param entryId - Unique entry ID (used as filename)
 * @param imageData - Base64 string or Buffer
 * @param mimeType - MIME type (e.g., 'image/png')
 * @returns Relative path to saved image
 */
export async function saveJournalImage(
  dir: string,
  experiment: string,
  entryId: string,
  imageData: string | Buffer,
  mimeType: string,
): Promise<string> {
  const safeName = sanitizeExperimentName(experiment)
  const imageDir = join(dir, `${safeName}-images`)
  await mkdir(imageDir, { recursive: true })

  const ext = mimeType.includes('png') ? 'png' : 'jpg'
  const filename = `${entryId}.${ext}`
  const imagePath = join(imageDir, filename)

  // Convert base64 to Buffer if needed, strip data URI prefix if present
  const buffer =
    typeof imageData === 'string'
      ? Buffer.from(imageData.replace(/^data:.*?;base64,/, ''), 'base64')
      : imageData
  await writeFile(imagePath, buffer)

  // Return relative path for markdown linking
  return `./${safeName}-images/${filename}`
}

/**
 * Map TokenUsage to JournalEntry.tokens shape.
 * Journal uses shorter field names (input/output vs inputTokens/outputTokens)
 * for compact JSONL serialization.
 */
function toJournalTokens(usage: TokenUsage): JournalEntry['tokens'] {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
    inputDetails: usage.inputDetails,
    outputDetails: usage.outputDetails,
  }
}

/**
 * Build a journal entry from LLM request/response data.
 * If imageData is provided, stores it for later saving by journal callbacks.
 */
export function createJournalEntry(params: CreateJournalEntryParams): JournalEntry {
  const tokens = toJournalTokens(params.tokens)

  const entry: JournalEntry = {
    id: generateEntryId(),
    timestamp: new Date().toISOString(),
    experiment: params.experiment,
    provider: params.provider,
    model: params.model,
    promptTemplate: params.promptTemplate,
    prompt: params.prompt,
    input: {
      text: params.context.text,
      hasImage: params.hasImage,
      hasPdf: params.hasPdf,
    },
    context: params.context,
    output: params.output,
    finishReason: params.finishReason,
    rawMeta: params.rawMeta,
    tokens,
    cost: params.cost,
    durationMs: params.durationMs,
    retries: params.retries,
    error: params.error,
  }

  // Store image data for later saving by journal callbacks
  if (params.imageData && params.imageMimeType) {
    pendingImageData.set(entry, { data: params.imageData, mimeType: params.imageMimeType })
  }

  return entry
}

/**
 * Create a file-based journal callback that appends entries to a JSONL file.
 *
 * Creates the directory if it doesn't exist.
 *
 * @param dir - Directory path for journal files (default: './experiments')
 * @param experiment - Experiment name (used as filename)
 * @returns JournalCallback that appends entries to `{dir}/{experiment}.jsonl`
 *
 * @example
 * ```typescript
 * const journal = await createFileJournal('./experiments', 'prompt-v1')
 *
 * // Pass to formatAsMarkdown
 * const result = await formatAsMarkdown(pages, {
 *   format: 'markdown',
 *   experiment: 'prompt-v1',
 *   onJournal: journal,
 * })
 *
 * // Journal file: ./experiments/prompt-v1.jsonl
 * ```
 */
export async function createFileJournal(dir: string, experiment: string): Promise<JournalCallback> {
  // Sanitize experiment name to prevent path traversal and invalid filenames
  const safeName = sanitizeExperimentName(experiment)
  if (!safeName) {
    throw new Error(`Invalid experiment name: "${experiment}"`)
  }

  // Ensure directory exists
  await mkdir(dir, { recursive: true })

  const filePath = join(dir, `${safeName}.jsonl`)

  return async (entry: JournalEntry): Promise<void> => {
    // Save pending image data if present
    const imageInfo = pendingImageData.get(entry)
    if (imageInfo) {
      entry.imagePath = await saveJournalImage(
        dir,
        experiment,
        entry.id,
        imageInfo.data,
        imageInfo.mimeType,
      )
      pendingImageData.delete(entry)
    }

    const line = `${JSON.stringify(entry)}\n`
    await appendFile(filePath, line, 'utf-8')
  }
}

/**
 * Get the journal file path for an experiment.
 * Applies the same sanitization as createFileJournal.
 */
export function getJournalPath(dir: string, experiment: string): string {
  const safeName = sanitizeExperimentName(experiment)
  return join(dir, `${safeName}.jsonl`)
}

/**
 * Sanitize experiment name for use as filename.
 * Replaces invalid characters with dashes.
 */
export function sanitizeExperimentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) // Limit length
}

/**
 * Format content as a code block, optionally collapsible if long.
 */
function formatContentBlock(content: string, label: string, tokenCount?: number): string {
  if (!content || content.length === 0) {
    return '_(empty)_\n'
  }

  const summary = tokenCount ? `${label} (${tokenCount} tokens)` : label

  if (content.length > COLLAPSIBLE_THRESHOLD) {
    return `<details>
<summary>${summary} - click to expand</summary>

\`\`\`text
${content}
\`\`\`

</details>\n`
  }

  return `\`\`\`text
${content}
\`\`\`
`
}

/**
 * Get finish reason display with warning indicator.
 */
function formatFinishReason(reason?: string): string {
  if (!reason || reason === 'unknown') return 'unknown'
  if (reason === 'stop') return 'stop ✓'
  if (reason === 'length') return 'length ⚠️ (hit token limit)'
  if (reason === 'content_filter') return 'content_filter ⚠️ (blocked)'
  return `${reason} ⚠️`
}

/**
 * Extract context info based on context type.
 */
function formatContextInfo(context: JournalContext): string {
  const lines: string[] = []

  // PageContext (PDF)
  if ('page' in context && 'totalPages' in context) {
    lines.push(`- **Page:** ${context.page}/${context.totalPages}`)
    if (context.language) lines.push(`- **Language:** ${context.language}`)
    if (context.pageKind) lines.push(`- **Page Kind:** ${context.pageKind}`)
  }
  // OfficeUnitContext
  else if ('unitLabel' in context && 'format' in context) {
    lines.push(`- **Unit:** ${context.unitLabel}`)
    lines.push(`- **Format:** ${context.format}`)
    if (context.contentKind) lines.push(`- **Content Kind:** ${context.contentKind}`)
  }
  // ImageContext
  else if ('filePath' in context && 'width' in context) {
    lines.push(`- **File:** ${context.filePath}`)
    lines.push(`- **Dimensions:** ${context.width}×${context.height}`)
    if (context.mimeType) lines.push(`- **Type:** ${context.mimeType}`)
  }

  return lines.join('\n')
}

/**
 * Format token details as a string for display with percentages.
 */
function formatTokenDetails(entry: JournalEntry): string {
  const details: string[] = []
  const { input, output, inputDetails, outputDetails } = entry.tokens

  // Input details with percentage
  if (inputDetails?.cached && inputDetails.cached > 0) {
    const pct = Math.round((inputDetails.cached / input) * 100)
    details.push(`${inputDetails.cached} cached (${pct}%)`)
  }
  if (inputDetails?.cacheCreation && inputDetails.cacheCreation > 0) {
    const pct = Math.round((inputDetails.cacheCreation / input) * 100)
    details.push(`${inputDetails.cacheCreation} cache-write (${pct}%)`)
  }

  // Output details with percentage
  if (outputDetails?.reasoning && outputDetails.reasoning > 0) {
    const pct = Math.round((outputDetails.reasoning / output) * 100)
    details.push(`${outputDetails.reasoning} reasoning (${pct}%)`)
  }

  return details.length > 0 ? details.join(', ') : ''
}

/**
 * Format cost breakdown as a string for display.
 */
function formatCostBreakdown(cost: JournalEntry['cost']): string {
  const parts: string[] = []

  if (cost.input !== undefined) {
    parts.push(`in: $${cost.input.toFixed(6)}`)
  }
  if (cost.output !== undefined) {
    parts.push(`out: $${cost.output.toFixed(6)}`)
  }
  if (cost.cached !== undefined && cost.cached > 0) {
    parts.push(`cached: $${cost.cached.toFixed(6)}`)
  }
  if (cost.reasoning !== undefined && cost.reasoning > 0) {
    parts.push(`reasoning: $${cost.reasoning.toFixed(6)}`)
  }

  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

/**
 * Format a journal entry as markdown.
 */
export function formatEntryAsMarkdown(entry: JournalEntry): string {
  const hasWarning =
    entry.finishReason && entry.finishReason !== 'stop' && entry.finishReason !== 'unknown'
  const statusIcon = hasWarning ? ' ⚠️' : ''

  const tokenDetails = formatTokenDetails(entry)
  const costBreakdown = formatCostBreakdown(entry.cost)

  const lines: string[] = [
    `## Entry ${entry.id}${statusIcon}`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Model** | ${entry.provider}/${entry.model} |`,
    `| **Timestamp** | ${entry.timestamp} |`,
    `| **Duration** | ${entry.durationMs}ms |`,
    `| **Tokens** | ${entry.tokens.input} in / ${entry.tokens.output} out |`,
  ]

  // Add token details row if there are any
  if (tokenDetails) {
    lines.push(`| **Token Details** | ${tokenDetails} |`)
  }

  lines.push(`| **Cost** | $${entry.cost.total.toFixed(6)}${costBreakdown} |`)
  lines.push(`| **Finish Reason** | ${formatFinishReason(entry.finishReason)} |`)

  if (entry.retries) {
    lines.push(`| **Retries** | ${entry.retries} |`)
  }

  if (entry.error) {
    lines.push(`| **Error** | ${entry.error} |`)
  }

  lines.push('')

  // Context section
  const contextInfo = formatContextInfo(entry.context)
  if (contextInfo) {
    lines.push('### Context')
    lines.push(contextInfo)
    lines.push('')
  }

  // Prompt template section (the base prompt before any context is added)
  if (entry.promptTemplate) {
    lines.push('### Prompt Template')
    lines.push(formatContentBlock(entry.promptTemplate, 'Template'))
  }

  // Full prompt section (the actual prompt sent to the LLM)
  if (entry.prompt && entry.prompt !== entry.promptTemplate) {
    lines.push('### Full Prompt')
    lines.push(formatContentBlock(entry.prompt, 'Prompt sent to LLM'))
  }

  // Input image section (if saved)
  if (entry.imagePath) {
    lines.push('### Input Image')
    lines.push(`![Input image](${entry.imagePath})`)
    lines.push('')
  }

  // Input section (extracted text from document)
  if (entry.input.text) {
    lines.push('### Extracted Text')
    lines.push(formatContentBlock(entry.input.text, 'Extracted text', entry.tokens.input))
  }

  // Output section
  lines.push('### Output')
  lines.push(formatContentBlock(entry.output, 'Output text', entry.tokens.output))

  // Raw metadata (collapsible)
  if (entry.rawMeta && Object.keys(entry.rawMeta).length > 0) {
    lines.push('<details>')
    lines.push('<summary>Raw Metadata</summary>')
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(entry.rawMeta, null, 2))
    lines.push('```')
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }

  lines.push('---')
  lines.push('')

  return lines.join('\n')
}

/**
 * Create a file-based journal callback that appends entries to a Markdown file.
 *
 * Creates the directory if it doesn't exist.
 *
 * @param dir - Directory path for journal files
 * @param experiment - Experiment name (used as filename)
 * @returns JournalCallback that appends entries to `{dir}/{experiment}.md`
 *
 * @example
 * ```typescript
 * const journal = await createMarkdownJournal('./experiments', 'prompt-v1')
 *
 * // Pass to formatAsMarkdown
 * const result = await formatAsMarkdown(pages, {
 *   format: 'markdown',
 *   experiment: 'prompt-v1',
 *   onJournal: journal,
 * })
 *
 * // Journal file: ./experiments/prompt-v1.md
 * ```
 */
export async function createMarkdownJournal(
  dir: string,
  experiment: string,
): Promise<JournalCallback> {
  const safeName = sanitizeExperimentName(experiment)
  if (!safeName) {
    throw new Error(`Invalid experiment name: "${experiment}"`)
  }

  await mkdir(dir, { recursive: true })

  const filePath = join(dir, `${safeName}.md`)

  // Check if file exists, if not create with header
  let fileExists = false
  try {
    await readFile(filePath)
    fileExists = true
  } catch {
    // File doesn't exist, will create with header
  }

  if (!fileExists) {
    const header = `# Experiment: ${experiment}\n\nGenerated by letmesense experiment journaling.\n\n---\n\n`
    await writeFile(filePath, header, 'utf-8')
  }

  return async (entry: JournalEntry): Promise<void> => {
    // Save pending image data if present
    const imageInfo = pendingImageData.get(entry)
    if (imageInfo) {
      entry.imagePath = await saveJournalImage(
        dir,
        experiment,
        entry.id,
        imageInfo.data,
        imageInfo.mimeType,
      )
      pendingImageData.delete(entry)
    }

    const markdown = formatEntryAsMarkdown(entry)
    await appendFile(filePath, markdown, 'utf-8')
  }
}

/**
 * Get the journal file path for an experiment.
 * Applies the same sanitization as createFileJournal/createMarkdownJournal.
 */
export function getMarkdownJournalPath(dir: string, experiment: string): string {
  const safeName = sanitizeExperimentName(experiment)
  return join(dir, `${safeName}.md`)
}
