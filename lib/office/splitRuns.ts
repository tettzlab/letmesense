/**
 * Group consecutive content units into runs with identical attributes.
 * Analogous to splitIntoRuns in letmesense.
 */

import type { ContentAttributes, ContentKind, ContentRun, Lang } from './types.js'

/**
 * Generate a unique key for a content run based on its attributes.
 * Units with the same key can be grouped into the same run.
 */
export function generateRunKey(attrs: Pick<ContentAttributes, 'kind' | 'language'>): string {
  return `${attrs.kind}|${attrs.language}`
}

/**
 * Split content attributes into homogeneous runs.
 *
 * A run groups consecutive content units that share the same:
 * - ContentKind (text-rich, image-heavy, mixed, empty, unknown)
 * - Language (for text-rich and mixed content)
 *
 * This allows batch processing of similar content types.
 *
 * @param attributes - Array of ContentAttributes from analysis
 * @returns Array of ContentRuns
 *
 * @example
 * ```ts
 * const attrs = [
 *   { unitIndex: 0, kind: 'text-rich', language: 'eng', ... },
 *   { unitIndex: 1, kind: 'text-rich', language: 'eng', ... },
 *   { unitIndex: 2, kind: 'image-heavy', language: 'und', ... },
 *   { unitIndex: 3, kind: 'text-rich', language: 'eng', ... },
 * ]
 *
 * const runs = splitIntoRuns(attrs)
 * // [
 * //   { key: 'text-rich|eng', unitIndices: [0, 1], ... },
 * //   { key: 'image-heavy|und', unitIndices: [2], ... },
 * //   { key: 'text-rich|eng', unitIndices: [3], ... },
 * // ]
 * ```
 */
export function splitIntoRuns(attributes: ContentAttributes[]): ContentRun[] {
  if (attributes.length === 0) {
    return []
  }

  const runs: ContentRun[] = []
  let currentRun: ContentRun | null = null

  for (const attr of attributes) {
    const key = generateRunKey(attr)

    if (currentRun && currentRun.key === key) {
      // Same run - add to current
      currentRun.unitIndices.push(attr.unitIndex)
    } else {
      // New run
      currentRun = {
        key,
        attrs: {
          kind: attr.kind,
          language: attr.language,
        },
        unitIndices: [attr.unitIndex],
      }
      runs.push(currentRun)
    }
  }

  return runs
}

/**
 * Merge all runs of the same type (ignore language differences).
 * Useful when you want to process all text content together.
 */
export function mergeRunsByKind(runs: ContentRun[]): ContentRun[] {
  const kindGroups = new Map<ContentKind, ContentRun>()

  for (const run of runs) {
    const existing = kindGroups.get(run.attrs.kind)
    if (existing) {
      existing.unitIndices.push(...run.unitIndices)
    } else {
      kindGroups.set(run.attrs.kind, {
        key: run.attrs.kind,
        attrs: { kind: run.attrs.kind, language: run.attrs.language },
        unitIndices: [...run.unitIndices],
      })
    }
  }

  return [...kindGroups.values()]
}

/**
 * Filter runs by content kind.
 */
export function filterRunsByKind(runs: ContentRun[], kinds: ContentKind[]): ContentRun[] {
  return runs.filter((run) => kinds.includes(run.attrs.kind))
}

/**
 * Get all unit indices from runs, in order.
 */
export function getUnitIndicesFromRuns(runs: ContentRun[]): number[] {
  return runs.flatMap((run) => run.unitIndices)
}

/**
 * Get runs that contain extractable text.
 */
export function getExtractableRuns(runs: ContentRun[]): ContentRun[] {
  return filterRunsByKind(runs, ['text-rich', 'mixed'])
}

/**
 * Get runs that require OCR for extraction.
 */
export function getOcrRequiredRuns(runs: ContentRun[]): ContentRun[] {
  return filterRunsByKind(runs, ['image-heavy'])
}

/**
 * Get statistics about runs.
 */
export function getRunStats(runs: ContentRun[]): {
  totalRuns: number
  totalUnits: number
  runsByKind: Record<ContentKind, number>
  unitsByKind: Record<ContentKind, number>
} {
  const runsByKind: Record<ContentKind, number> = {
    'text-rich': 0,
    'image-heavy': 0,
    mixed: 0,
    table: 0,
    empty: 0,
    unknown: 0,
  }

  const unitsByKind: Record<ContentKind, number> = {
    'text-rich': 0,
    'image-heavy': 0,
    mixed: 0,
    table: 0,
    empty: 0,
    unknown: 0,
  }

  for (const run of runs) {
    runsByKind[run.attrs.kind]++
    unitsByKind[run.attrs.kind] += run.unitIndices.length
  }

  return {
    totalRuns: runs.length,
    totalUnits: runs.reduce((sum, run) => sum + run.unitIndices.length, 0),
    runsByKind,
    unitsByKind,
  }
}

/**
 * Sort runs by their first unit index.
 */
export function sortRunsByIndex(runs: ContentRun[]): ContentRun[] {
  return [...runs].sort((a, b) => {
    const aFirst = a.unitIndices[0] ?? 0
    const bFirst = b.unitIndices[0] ?? 0
    return aFirst - bFirst
  })
}

/**
 * Get the dominant language across all runs.
 */
export function getDominantLanguage(runs: ContentRun[]): Lang {
  const langCounts = new Map<Lang, number>()

  for (const run of runs) {
    const lang = run.attrs.language
    if (lang && lang !== 'und') {
      const unitCount = run.unitIndices.length
      langCounts.set(lang, (langCounts.get(lang) ?? 0) + unitCount)
    }
  }

  if (langCounts.size === 0) {
    return 'und'
  }

  let dominantLang: Lang = 'und'
  let maxCount = 0

  for (const [lang, count] of langCounts) {
    if (count > maxCount) {
      maxCount = count
      dominantLang = lang
    }
  }

  return dominantLang
}
