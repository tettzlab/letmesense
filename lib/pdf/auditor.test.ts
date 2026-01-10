import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { splitIntoRuns } from './splitRuns.js'

const TREACH = path.resolve('samples/treacherous.pdf')

describe('letmesense samples', () => {
  test('classifies page kinds and splits into homogeneous runs', async () => {
    const pdfBytes = new Uint8Array(await fs.readFile(TREACH))
    const { pages, runs } = await splitIntoRuns(pdfBytes, {
      includePdfBytes: false,
      minCharsForLangDetect: 0, // keep test resilient; we focus on kind/size/orientation
    })

    expect(pages.length).toBe(6)

    // Pages (1-based in comment):
    // 1: born-digital A4 portrait
    // 2: scanned-image A4 portrait
    // 3: mixed A4 portrait
    // 4: born-digital Letter landscape
    // 5: scanned-image Letter landscape (rotated / landscape)
    // 6: born-digital A4 portrait (Japanese)
    expect(pages[0].kind).toBe('born-digital')
    expect(pages[1].kind).toBe('scanned-image')
    expect(pages[2].kind).toBe('mixed')
    expect(pages[3].kind).toBe('born-digital')
    expect(pages[4].kind).toBe('scanned-image')
    expect(pages[5].kind).toBe('born-digital')

    // Check paper/orientation keys are stable-ish.
    expect(pages[0].orientation).toBe('portrait')
    expect(pages[3].orientation).toBe('landscape')

    // Runs should break whenever attributes change.
    // With our sample, expect 6 runs (each page differs by kind or size/orientation).
    expect(runs.length).toBe(6)
    expect(runs[0].pageIndices).toEqual([0])
    expect(runs[1].pageIndices).toEqual([1])
    expect(runs[2].pageIndices).toEqual([2])
    expect(runs[3].pageIndices).toEqual([3])
    expect(runs[4].pageIndices).toEqual([4])
    expect(runs[5].pageIndices).toEqual([5])
  })
})
