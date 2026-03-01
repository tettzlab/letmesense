import {
  apply,
  clamp01,
  type Matrix,
  multiply,
  parallelogramArea,
  transformedUnitSquareBBox,
} from './imageCoverage.js'

describe('imageCoverage helpers', () => {
  describe('multiply', () => {
    it('multiplies identity matrices', () => {
      const identity: Matrix = [1, 0, 0, 1, 0, 0]
      expect(multiply(identity, identity)).toEqual([1, 0, 0, 1, 0, 0])
    })

    it('multiplies with identity returns original', () => {
      const identity: Matrix = [1, 0, 0, 1, 0, 0]
      const m: Matrix = [2, 0, 0, 3, 10, 20]
      expect(multiply(identity, m)).toEqual(m)
      expect(multiply(m, identity)).toEqual(m)
    })

    it('multiplies scale matrices', () => {
      const scale2x: Matrix = [2, 0, 0, 2, 0, 0]
      const scale3x: Matrix = [3, 0, 0, 3, 0, 0]
      expect(multiply(scale2x, scale3x)).toEqual([6, 0, 0, 6, 0, 0])
    })

    it('multiplies translation matrices', () => {
      const t1: Matrix = [1, 0, 0, 1, 10, 0]
      const t2: Matrix = [1, 0, 0, 1, 0, 20]
      expect(multiply(t1, t2)).toEqual([1, 0, 0, 1, 10, 20])
    })

    it('multiplies scale then translate', () => {
      const scale: Matrix = [2, 0, 0, 2, 0, 0]
      const translate: Matrix = [1, 0, 0, 1, 5, 10]
      // Scale first, then translate: translation is applied in scaled space
      expect(multiply(scale, translate)).toEqual([2, 0, 0, 2, 10, 20])
    })

    it('multiplies rotation matrix (90 degrees)', () => {
      const rot90: Matrix = [0, 1, -1, 0, 0, 0]
      // Two 90 degree rotations = 180 degrees
      const result = multiply(rot90, rot90)
      // Use closeTo for floating point comparison (-0 vs 0 issue)
      expect(result[0]).toBeCloseTo(-1)
      expect(result[1]).toBeCloseTo(0)
      expect(result[2]).toBeCloseTo(0)
      expect(result[3]).toBeCloseTo(-1)
      expect(result[4]).toBeCloseTo(0)
      expect(result[5]).toBeCloseTo(0)
    })

    it('handles zero matrix', () => {
      const zero: Matrix = [0, 0, 0, 0, 0, 0]
      const m: Matrix = [1, 2, 3, 4, 5, 6]
      expect(multiply(zero, m)).toEqual([0, 0, 0, 0, 0, 0])
    })
  })

  describe('parallelogramArea', () => {
    it('returns area of identity (unit square)', () => {
      const identity: Matrix = [1, 0, 0, 1, 0, 0]
      expect(parallelogramArea(identity)).toBe(1)
    })

    it('returns area of scaled square', () => {
      const scale2x: Matrix = [2, 0, 0, 2, 0, 0]
      expect(parallelogramArea(scale2x)).toBe(4)
    })

    it('returns area of non-uniform scale', () => {
      const scale: Matrix = [3, 0, 0, 4, 0, 0]
      expect(parallelogramArea(scale)).toBe(12)
    })

    it('returns area of rotated unit square', () => {
      const rot90: Matrix = [0, 1, -1, 0, 0, 0]
      expect(parallelogramArea(rot90)).toBe(1)
    })

    it('returns positive area for negative scale', () => {
      const negScale: Matrix = [-2, 0, 0, -3, 0, 0]
      expect(parallelogramArea(negScale)).toBe(6)
    })

    it('returns zero for degenerate matrix', () => {
      const degenerate: Matrix = [1, 2, 2, 4, 0, 0] // cols are linearly dependent
      expect(parallelogramArea(degenerate)).toBe(0)
    })

    it('handles skew transformation', () => {
      // Skew: [1, 0, k, 1, 0, 0] has area = 1
      const skew: Matrix = [1, 0, 0.5, 1, 0, 0]
      expect(parallelogramArea(skew)).toBe(1)
    })
  })

  describe('apply', () => {
    it('applies identity transform', () => {
      const identity: Matrix = [1, 0, 0, 1, 0, 0]
      expect(apply(identity, 5, 10)).toEqual([5, 10])
    })

    it('applies translation', () => {
      const translate: Matrix = [1, 0, 0, 1, 100, 200]
      expect(apply(translate, 0, 0)).toEqual([100, 200])
      expect(apply(translate, 5, 10)).toEqual([105, 210])
    })

    it('applies scale', () => {
      const scale: Matrix = [2, 0, 0, 3, 0, 0]
      expect(apply(scale, 5, 10)).toEqual([10, 30])
    })

    it('applies rotation (90 degrees)', () => {
      const rot90: Matrix = [0, 1, -1, 0, 0, 0]
      expect(apply(rot90, 1, 0)).toEqual([0, 1])
      expect(apply(rot90, 0, 1)).toEqual([-1, 0])
    })

    it('applies origin point', () => {
      const m: Matrix = [2, 0, 0, 3, 10, 20]
      expect(apply(m, 0, 0)).toEqual([10, 20])
    })
  })

  describe('transformedUnitSquareBBox', () => {
    it('returns unit square bbox for identity', () => {
      const identity: Matrix = [1, 0, 0, 1, 0, 0]
      expect(transformedUnitSquareBBox(identity)).toEqual({
        minX: 0,
        minY: 0,
        maxX: 1,
        maxY: 1,
      })
    })

    it('returns scaled bbox', () => {
      const scale: Matrix = [2, 0, 0, 3, 0, 0]
      expect(transformedUnitSquareBBox(scale)).toEqual({
        minX: 0,
        minY: 0,
        maxX: 2,
        maxY: 3,
      })
    })

    it('returns translated bbox', () => {
      const translate: Matrix = [1, 0, 0, 1, 10, 20]
      expect(transformedUnitSquareBBox(translate)).toEqual({
        minX: 10,
        minY: 20,
        maxX: 11,
        maxY: 21,
      })
    })

    it('handles negative scale (flip)', () => {
      const flipX: Matrix = [-1, 0, 0, 1, 0, 0]
      expect(transformedUnitSquareBBox(flipX)).toEqual({
        minX: -1,
        minY: 0,
        maxX: 0,
        maxY: 1,
      })
    })

    it('handles rotation (90 degrees)', () => {
      const rot90: Matrix = [0, 1, -1, 0, 0, 0]
      expect(transformedUnitSquareBBox(rot90)).toEqual({
        minX: -1,
        minY: 0,
        maxX: 0,
        maxY: 1,
      })
    })
  })

  describe('clamp01', () => {
    it('clamps negative values to 0', () => {
      expect(clamp01(-0.5)).toBe(0)
      expect(clamp01(-100)).toBe(0)
    })

    it('clamps values above 1 to 1', () => {
      expect(clamp01(1.5)).toBe(1)
      expect(clamp01(100)).toBe(1)
    })

    it('passes through values in range', () => {
      expect(clamp01(0)).toBe(0)
      expect(clamp01(0.5)).toBe(0.5)
      expect(clamp01(1)).toBe(1)
    })

    it('handles edge cases', () => {
      expect(clamp01(0.0001)).toBe(0.0001)
      expect(clamp01(0.9999)).toBe(0.9999)
    })
  })
})
