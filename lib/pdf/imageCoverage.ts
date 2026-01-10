import type { PDFPageProxy } from './pdfjs.js'
import { getSafeOPS } from './pdfjsTypes.js'

export type Matrix = [number, number, number, number, number, number]

export interface ImageCoverageStats {
  pageAreaPt2: number
  maxImageCoverageRatio: number
  totalImageCoverageRatio: number
  largeImageCount: number
  images: Array<{
    opIndex: number
    matrix: Matrix
    parallelogramAreaPt2: number
    bbox: { minX: number; minY: number; maxX: number; maxY: number }
    bboxAreaPt2: number
    coverageRatio: number
  }>
}

export interface ImageCoverageOptions {
  minImageCoverageToCount?: number // default 0.02
}

const DEFAULTS: Required<ImageCoverageOptions> = {
  minImageCoverageToCount: 0.02,
}

export async function estimateImageCoverageFromPage(
  page: PDFPageProxy,
  options: ImageCoverageOptions = {},
): Promise<ImageCoverageStats> {
  const cfg = { ...DEFAULTS, ...options }

  const userUnit = typeof page.userUnit === 'number' ? page.userUnit : 1
  const view = Array.isArray(page.view) ? page.view : [0, 0, 0, 0]
  const widthPt = Math.abs((view[2] - view[0]) * userUnit)
  const heightPt = Math.abs((view[3] - view[1]) * userUnit)
  const pageAreaPt2 = Math.max(1, widthPt * heightPt)

  const opList = await page.getOperatorList()
  const fns: number[] = opList?.fnArray ?? []
  const args: unknown[] = opList?.argsArray ?? []

  const OPS = getSafeOPS()

  let ctm: Matrix = [1, 0, 0, 1, 0, 0]
  const stack: Matrix[] = []

  const images: ImageCoverageStats['images'] = []
  let totalArea = 0
  let maxRatio = 0
  let largeImageCount = 0

  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]

    if (fn === OPS.save) {
      stack.push(ctm)
      continue
    }
    if (fn === OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
      continue
    }

    if (fn === OPS.transform) {
      const m = args[i] as Matrix
      ctm = multiply(ctm, m)
      continue
    }

    // Not always present, but handle just in case.
    if (OPS.setTransform !== undefined && fn === OPS.setTransform) {
      const m = args[i] as Matrix
      ctm = m
      continue
    }

    if (
      fn === OPS.paintImageXObject ||
      (OPS.paintJpegXObject !== undefined && fn === OPS.paintJpegXObject) ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintInlineImageXObjectGroup ||
      fn === OPS.paintImageXObjectRepeat
    ) {
      const area = parallelogramArea(ctm)
      const ratio = clamp01(area / pageAreaPt2)

      const bbox = transformedUnitSquareBBox(ctm)
      const bboxAreaPt2 = Math.max(0, (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY))

      images.push({
        opIndex: i,
        matrix: ctm,
        parallelogramAreaPt2: area,
        bbox,
        bboxAreaPt2,
        coverageRatio: ratio,
      })

      if (ratio > maxRatio) maxRatio = ratio

      // Only count/sum images that are “big enough” (filters logos/icons).
      if (ratio >= cfg.minImageCoverageToCount) {
        totalArea += area
        largeImageCount++
      }
    }
  }

  return {
    pageAreaPt2,
    maxImageCoverageRatio: maxRatio,
    totalImageCoverageRatio: clamp01(totalArea / pageAreaPt2),
    largeImageCount,
    images,
  }
}

/** @internal Exported for testing */
export function multiply(A: Matrix, B: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = A
  const [a2, b2, c2, d2, e2, f2] = B

  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

/** @internal Exported for testing */
export function parallelogramArea(m: Matrix): number {
  const [a, b, c, d] = m
  return Math.abs(a * d - b * c)
}

/** @internal Exported for testing */
export function transformedUnitSquareBBox(m: Matrix): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const pts = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

/** @internal Exported for testing */
export function apply(m: Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m
  return [a * x + c * y + e, b * x + d * y + f]
}

/** @internal Exported for testing */
export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
