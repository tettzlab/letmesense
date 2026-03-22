/**
 * Core map-reduce condensation engine.
 *
 * Splits long text into chunks, summarizes each via LLM (map phase),
 * then recursively merges summaries until the output fits a target size.
 */

import { calculateCost } from '../ai/cost.js'
import { createModel } from '../ai/createModel.js'
import { getProviderConfig, initModelRegistry, isRegistryConfigured } from '../ai/models.js'
import { detectProvider } from '../ai/provider.js'
import { type ResolvedModel, resolveModel } from '../ai/resolve.js'
import { addGuardrail } from '../ai/sanitize.js'
import { generateTextWithRetry, type StreamRetryOptions } from '../ai/stream.server.js'
import { countTokensWithEncoding } from '../ai/tokenCounter.js'
import { obs, SemanticAttributes } from '../observability/index.js'
import { chunkMarkdown } from './chunker.js'
import {
  MAP_SYSTEM_PROMPT_HIGH,
  MAP_SYSTEM_PROMPT_LOW,
  MAP_SYSTEM_PROMPT_MEDIUM,
  MAP_USER_PROMPT,
  REDUCE_SYSTEM_PROMPT,
  REDUCE_USER_PROMPT,
  substitutePromptVars,
} from './prompts.js'
import { Metrics, Spans } from './signals.js'
import {
  CHARS_PER_TOKEN_ESTIMATE,
  CONTEXT_WINDOW_INPUT_FRACTION,
  type CondenseCost,
  type CondenseOptions,
  type CondenseResult,
  type CondenseTokenUsage,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RECURSION_DEPTH,
  DEFAULT_OVERLAP_TOKENS,
  PROMPT_OVERHEAD_TOKENS,
} from './types.js'

const { logger, tracer, metrics } = obs('condense')

/** Ratio (%) below which "high compression" map prompts are used. */
const RATIO_HIGH_THRESHOLD = 10
/** Ratio (%) below which "medium compression" map prompts are used. */
const RATIO_MEDIUM_THRESHOLD = 50

/**
 * Forward explicit model-registry options to initModelRegistry().
 * If neither is set, loadModelsJson() handles env vars and ./models.json fallback.
 */
function ensureModelsConfigured(options: CondenseOptions): void {
  if (isRegistryConfigured()) return
  if (options.modelsJson) {
    initModelRegistry({ json: options.modelsJson })
  } else if (options.modelsFile) {
    initModelRegistry({ file: options.modelsFile })
  }
}

/**
 * Condense long text using a map-reduce LLM strategy.
 *
 * @param text - Full input text (markdown)
 * @param options - Condensation options
 * @returns Condensed result with usage and cost metadata
 */
export async function condense(text: string, options: CondenseOptions): Promise<CondenseResult> {
  ensureModelsConfigured(options)

  return tracer.startSpan(Spans.RUN, async (span) => {
    const startMs = Date.now()

    // ── Resolve model ──────────────────────────────────────────────────────
    const resolved = resolveCondenseModel(options.model)
    const model = createModel({
      provider: resolved.provider,
      modelId: resolved.modelId,
      effort: resolved.effort,
    })
    const countTokens = (t: string) => countTokensWithEncoding(t, resolved.encoding)

    span.setAttribute(SemanticAttributes.MODEL, resolved.modelId)
    span.setAttribute(SemanticAttributes.PROVIDER, resolved.provider)

    logger.info(
      {
        model: resolved.modelId,
        provider: resolved.provider,
        contextWindow: resolved.contextWindow,
        maxOutputTokens: resolved.maxOutputTokens,
        encoding: resolved.encoding,
      },
      'Model resolved',
    )

    // ── Resolve target ─────────────────────────────────────────────────────
    const inputTokens = countTokens(text)
    const targetTokens = resolveTarget(options.target, inputTokens)

    const targetRatioPercent = inputTokens > 0 ? Math.round((targetTokens / inputTokens) * 100) : 0
    const targetSource =
      options.target.maxChars != null
        ? 'maxChars'
        : options.target.maxTokens != null
          ? 'maxTokens'
          : 'ratio'

    span.setAttribute(SemanticAttributes.TOTAL_INPUT_TOKENS, inputTokens)
    span.setAttribute(SemanticAttributes.CHAR_COUNT, text.length)
    span.setAttribute('target.tokens', targetTokens)
    span.setAttribute('target.ratio', targetRatioPercent)
    span.setAttribute('target.source', targetSource)

    logger.info(
      {
        inputTokens,
        inputChars: text.length,
        targetTokens,
        targetRatio: `${targetRatioPercent}%`,
        targetSource,
      },
      'Target resolved',
    )

    options.onProgress?.({
      phase: 'start',
      totalChars: text.length,
      targetTokens,
      targetChars: options.target.maxChars,
    })

    const usage: CondenseTokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      mapCalls: 0,
      reduceCalls: 0,
      reduceDepth: 0,
    }
    const cost: CondenseCost = { total: 0, map: 0, reduce: 0 }
    let success = false
    let passthrough = false

    /** Set final span attrs and emit the summary log. */
    function logCompletion(outputTokens: number): void {
      const ratio = inputTokens > 0 ? Math.round((outputTokens / inputTokens) * 100) : 0
      span.setAttribute(SemanticAttributes.TOTAL_OUTPUT_TOKENS, outputTokens)
      span.setAttribute(SemanticAttributes.COST_TOTAL_USD, cost.total)
      span.setAttribute('map.calls', usage.mapCalls)
      span.setAttribute('reduce.calls', usage.reduceCalls)
      span.setAttribute('reduce.depth', usage.reduceDepth)
      span.setAttribute('output.ratio', ratio)

      logger.info(
        {
          inputTokens,
          outputTokens,
          targetTokens,
          overallRatio: `${ratio}%`,
          mapCalls: usage.mapCalls,
          reduceCalls: usage.reduceCalls,
          reduceDepth: usage.reduceDepth,
          costUsd: cost.total,
        },
        'Condensation complete',
      )
    }

    try {
      // ── Passthrough check ──────────────────────────────────────────────────
      if (inputTokens <= targetTokens) {
        logger.info({ inputTokens, targetTokens }, 'Input fits target — passthrough')
        success = true
        passthrough = true
        span.setAttribute('passthrough', true)
        logCompletion(inputTokens)
        options.onProgress?.({ phase: 'done', ratio: 1 })
        return buildResult(text, text, resolved, usage, cost, true)
      }

      // ── Calculate chunk size ───────────────────────────────────────────────
      const maxChunkTokens =
        options.maxChunkTokens ??
        Math.max(
          Math.floor(
            resolved.contextWindow * CONTEXT_WINDOW_INPUT_FRACTION - PROMPT_OVERHEAD_TOKENS,
          ),
          resolved.maxOutputTokens,
        )

      if (options.maxChunkTokens != null && options.maxChunkTokens >= resolved.contextWindow) {
        throw new Error(
          `maxChunkTokens (${options.maxChunkTokens}) must be less than model context window (${resolved.contextWindow}) to leave room for prompts and output`,
        )
      }

      const chunkSizeSource = options.maxChunkTokens != null ? 'user-override' : 'auto'
      span.setAttribute('chunk.max.tokens', maxChunkTokens)
      span.setAttribute('chunk.size.source', chunkSizeSource)

      logger.info(
        {
          maxChunkTokens,
          chunkSizeSource,
          contextWindow: resolved.contextWindow,
          inputFraction: CONTEXT_WINDOW_INPUT_FRACTION,
          promptOverhead: PROMPT_OVERHEAD_TOKENS,
        },
        'Chunk size calculated',
      )

      // ── Chunk ──────────────────────────────────────────────────────────────
      const strategy = options.chunkStrategy ?? 'heading'
      const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS
      const chunks = chunkMarkdown(text, maxChunkTokens, strategy, overlapTokens, countTokens)

      if (chunks.length === 0) {
        logger.warn(
          { strategy, maxChunkTokens },
          'Chunking produced no chunks — returning passthrough',
        )
        success = true
        passthrough = true
        span.setAttribute('passthrough', true)
        logCompletion(inputTokens)
        options.onProgress?.({ phase: 'done', ratio: 1 })
        return buildResult(text, text, resolved, usage, cost, true)
      }

      logger.info(
        {
          chunkCount: chunks.length,
          strategy,
          overlapTokens,
          avgChunkTokens:
            chunks.length > 0
              ? Math.round(chunks.reduce((s, c) => s + c.tokenCount, 0) / chunks.length)
              : 0,
          smallestChunkTokens: chunks.length > 0 ? Math.min(...chunks.map((c) => c.tokenCount)) : 0,
          largestChunkTokens: chunks.length > 0 ? Math.max(...chunks.map((c) => c.tokenCount)) : 0,
        },
        'Chunking complete',
      )

      options.onProgress?.({ phase: 'chunk', chunkCount: chunks.length, strategy })
      span.setAttribute('chunk.count', chunks.length)
      span.setAttribute('chunk.strategy', strategy)

      // ── Map phase ──────────────────────────────────────────────────────────
      const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
      const retryOpts: StreamRetryOptions | undefined = options.retry
      const promptLevel =
        options.mapSystemPrompt != null
          ? 'custom'
          : targetRatioPercent < RATIO_HIGH_THRESHOLD
            ? 'high'
            : targetRatioPercent < RATIO_MEDIUM_THRESHOLD
              ? 'medium'
              : 'low'
      const mapSystemPrompt =
        options.mapSystemPrompt ??
        (targetRatioPercent < RATIO_HIGH_THRESHOLD
          ? MAP_SYSTEM_PROMPT_HIGH
          : targetRatioPercent < RATIO_MEDIUM_THRESHOLD
            ? MAP_SYSTEM_PROMPT_MEDIUM
            : MAP_SYSTEM_PROMPT_LOW)
      const mapUserPrompt = options.mapUserPrompt ?? MAP_USER_PROMPT

      span.setAttribute('concurrency', concurrency)
      span.setAttribute('prompt.level', promptLevel)
      span.setAttribute('chunk.overlap.tokens', overlapTokens)

      logger.info(
        {
          concurrency,
          targetRatio: `${targetRatioPercent}%`,
          promptLevel,
          chunkCount: chunks.length,
          customUserPrompt: options.mapUserPrompt != null,
        },
        'Map phase starting',
      )

      const summaries = await tracer.startSpan(Spans.MAP, async () => {
        const results: string[] = []

        // Process in batches for concurrency control
        for (let i = 0; i < chunks.length; i += concurrency) {
          options.signal?.throwIfAborted()

          const batch = chunks.slice(i, i + concurrency)
          const batchResults = await Promise.all(
            batch.map(async (chunk) => {
              options.onProgress?.({
                phase: 'map',
                chunkIndex: chunk.index,
                totalChunks: chunks.length,
              })

              const headingCtx =
                chunk.headingContext.length > 0
                  ? `Context: ${chunk.headingContext.join(' > ')}\n\n`
                  : ''

              const userPrompt = substitutePromptVars(mapUserPrompt, {
                text: chunk.text,
                targetRatio: targetRatioPercent,
                headingContext: headingCtx,
              })

              return callLlm(
                model,
                mapSystemPrompt,
                userPrompt,
                options.signal,
                retryOpts,
                resolved,
                usage,
                cost,
                'map',
                { chunkIndex: chunk.index },
              )
            }),
          )

          results.push(...batchResults)
        }

        return results
      })

      const summaryText = summaries.join('\n\n')
      const summaryTokens = countTokens(summaryText)

      logger.info(
        {
          summaryTokens,
          targetTokens,
          mapCalls: usage.mapCalls,
          compressionRatio:
            inputTokens > 0 ? `${Math.round((summaryTokens / inputTokens) * 100)}%` : '0%',
          needsReduce: summaryTokens > targetTokens,
        },
        'Map phase complete',
      )

      options.onProgress?.({ phase: 'map-done', summaryTokens })
      metrics.counter(Metrics.MAP_CHUNK_COUNT).add(chunks.length)

      // ── Check fit ──────────────────────────────────────────────────────────
      if (summaryTokens <= targetTokens) {
        logger.info({ summaryTokens, targetTokens }, 'Summaries fit target — skipping reduce')
        success = true
        logCompletion(summaryTokens)
        options.onProgress?.({ phase: 'done', ratio: summaryText.length / text.length })
        return buildResult(text, summaryText, resolved, usage, cost, false)
      }

      // ── Reduce phase ───────────────────────────────────────────────────────
      const maxDepth = options.maxRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH
      const reduceSystemPrompt = options.reduceSystemPrompt ?? REDUCE_SYSTEM_PROMPT
      const reduceUserPrompt = options.reduceUserPrompt ?? REDUCE_USER_PROMPT

      let current = summaryText
      let currentTokens = summaryTokens

      logger.info(
        { currentTokens, targetTokens, maxDepth, gap: currentTokens - targetTokens },
        'Reduce phase starting',
      )

      await tracer.startSpan(Spans.REDUCE, async () => {
        for (let depth = 1; depth <= maxDepth; depth++) {
          options.signal?.throwIfAborted()
          options.onProgress?.({ phase: 'reduce', depth, inputTokens: currentTokens })

          const needsRechunk = currentTokens > maxChunkTokens
          logger.debug(
            { depth, maxDepth, currentTokens, targetTokens, needsRechunk, maxChunkTokens },
            'Reduce round starting',
          )

          // Re-chunk if current text exceeds max chunk size
          let reduceInput: string
          if (needsRechunk) {
            const reduceChunks = chunkMarkdown(current, maxChunkTokens, 'paragraph', 0, countTokens)
            logger.debug(
              { depth, reduceChunkCount: reduceChunks.length },
              'Reduce round re-chunked (text exceeds max chunk size)',
            )
            // Reduce each chunk, then concatenate
            const reducedParts: string[] = []
            for (let ci = 0; ci < reduceChunks.length; ci++) {
              const chunk = reduceChunks[ci]
              const userPrompt = substitutePromptVars(reduceUserPrompt, {
                text: chunk.text,
                targetChars: Math.ceil(
                  (targetTokens / reduceChunks.length) * CHARS_PER_TOKEN_ESTIMATE,
                ),
              })

              const resultText = await callLlm(
                model,
                reduceSystemPrompt,
                userPrompt,
                options.signal,
                retryOpts,
                resolved,
                usage,
                cost,
                'reduce',
                { chunkIndex: ci, reduceDepth: depth },
              )
              reducedParts.push(resultText)
            }
            reduceInput = reducedParts.join('\n\n')
          } else {
            const userPrompt = substitutePromptVars(reduceUserPrompt, {
              text: current,
              targetChars: Math.round(targetTokens * CHARS_PER_TOKEN_ESTIMATE),
            })

            reduceInput = await callLlm(
              model,
              reduceSystemPrompt,
              userPrompt,
              options.signal,
              retryOpts,
              resolved,
              usage,
              cost,
              'reduce',
              { reduceDepth: depth },
            )
          }

          usage.reduceDepth = depth

          const newTokens = countTokens(reduceInput)
          const shrinkPct = Math.round(((currentTokens - newTokens) / currentTokens) * 100)
          options.onProgress?.({ phase: 'reduce-done', depth, outputTokens: newTokens })

          logger.debug(
            {
              depth,
              inputTokens: currentTokens,
              outputTokens: newTokens,
              shrink: `${shrinkPct}%`,
              targetTokens,
              reachedTarget: newTokens <= targetTokens,
            },
            'Reduce round complete',
          )

          // Convergence guard — stop if no meaningful reduction
          if (newTokens >= currentTokens) {
            logger.info(
              { depth, newTokens, currentTokens },
              'Reduce pass did not shrink text — stopping (convergence)',
            )
            current = reduceInput
            currentTokens = newTokens
            break
          }

          current = reduceInput
          currentTokens = newTokens

          if (currentTokens <= targetTokens) {
            logger.info({ depth, currentTokens, targetTokens }, 'Target reached after reduce')
            break
          }
        }
      })

      success = true
      logCompletion(currentTokens)

      options.onProgress?.({ phase: 'done', ratio: current.length / text.length })
      return buildResult(text, current, resolved, usage, cost, false)
    } finally {
      recordFinalMetrics(usage, cost, startMs, success, passthrough)
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveCondenseModel(modelSpec?: string): ResolvedModel {
  if (modelSpec) return resolveModel(modelSpec)

  // Auto-detect provider and use its default model
  const detected = detectProvider()
  if (!detected) throw new Error('No LLM provider available. Set an API key or pass --model.')
  const provider = getProviderConfig(detected.provider)
  return resolveModel(provider.defaultModel, detected.provider)
}

function resolveTarget(target: CondenseOptions['target'], inputTokens: number): number {
  if (target.maxChars != null) {
    return Math.ceil(target.maxChars / CHARS_PER_TOKEN_ESTIMATE)
  }
  if (target.maxTokens != null) {
    return target.maxTokens
  }
  if (target.ratio != null) {
    return Math.ceil(inputTokens * target.ratio)
  }
  throw new Error(
    `CondenseTarget must specify maxChars, maxTokens, or ratio — got: ${JSON.stringify(target)}`,
  )
}

function buildResult(
  input: string,
  output: string,
  resolved: ResolvedModel,
  usage: CondenseTokenUsage,
  cost: CondenseCost,
  passthrough: boolean,
): CondenseResult {
  return {
    text: output,
    inputChars: input.length,
    outputChars: output.length,
    ratio: input.length > 0 ? output.length / input.length : 1,
    usage,
    cost,
    model: resolved.modelId,
    provider: resolved.provider,
    passthrough,
  }
}

/** Context for attributing a callLlm invocation within the condense pipeline. */
interface CallLlmContext {
  chunkIndex?: number
  reduceDepth?: number
}

/** Call LLM with retry, accumulate usage/cost, return generated text. */
async function callLlm(
  model: ReturnType<typeof createModel>,
  systemPrompt: string,
  userPrompt: string,
  signal: AbortSignal | undefined,
  retryOpts: StreamRetryOptions | undefined,
  resolved: ResolvedModel,
  usage: CondenseTokenUsage,
  cost: CondenseCost,
  phase: 'map' | 'reduce',
  ctx?: CallLlmContext,
): Promise<string> {
  return tracer.startSpan(Spans.LLM, async (span) => {
    span.setAttribute('phase', phase)
    if (ctx?.chunkIndex !== undefined) span.setAttribute('chunk.index', ctx.chunkIndex)
    if (ctx?.reduceDepth !== undefined) span.setAttribute('reduce.depth', ctx.reduceDepth)

    const result = await generateTextWithRetry(
      {
        model,
        system: addGuardrail(systemPrompt),
        messages: [{ role: 'user', content: userPrompt }],
        maxOutputTokens: resolved.maxOutputTokens,
        abortSignal: signal,
      },
      retryOpts,
    )

    if (!result.success || !result.result)
      throw (
        result.error ??
        new Error(
          `${phase} call failed after ${result.attempts} attempt(s) (${result.finalCategory})`,
        )
      )

    const r = result.result
    const inTok = r.usage.inputTokens ?? 0
    const outTok = r.usage.outputTokens ?? 0

    span.setAttribute(SemanticAttributes.INPUT_TOKENS, inTok)
    span.setAttribute(SemanticAttributes.OUTPUT_TOKENS, outTok)

    usage.inputTokens += inTok
    usage.outputTokens += outTok
    if (phase === 'map') usage.mapCalls++
    else usage.reduceCalls++

    const callCost = calculateCost(inTok, outTok, 0, resolved.pricing)
    cost[phase] += callCost
    cost.total += callCost

    return r.text
  })
}

function recordFinalMetrics(
  usage: CondenseTokenUsage,
  cost: CondenseCost,
  startMs: number,
  success: boolean,
  passthrough: boolean,
): void {
  const status = success ? 'success' : 'error'
  metrics.counter(Metrics.RUN_COUNT).add(1, { status, passthrough: String(passthrough) })
  metrics.histogram(Metrics.RUN_DURATION_MS).record(Date.now() - startMs)
  if (!success) {
    metrics.counter(Metrics.ERROR_COUNT).add(1)
  }
  metrics.counter(Metrics.TOKEN_INPUT_COUNT).add(usage.inputTokens)
  metrics.counter(Metrics.TOKEN_OUTPUT_COUNT).add(usage.outputTokens)
  metrics.histogram(Metrics.REDUCE_DEPTH).record(usage.reduceDepth)
  metrics.histogram(Metrics.COST_USD).record(cost.total)
}
