import { describe, expect, test } from 'vitest'
import type { VectorDistanceFunction } from '../config/types.js'
import {
  VECTOR_DISTANCE_FUNCTIONS,
  VectorDecodeError,
  distanceToScore,
  isVectorDistanceFunction,
  minScoreToDistanceBound,
  requireVector,
  vectorDistance,
} from './vector.js'

/**
 * The distances each function can actually produce, and scores inside the
 * range it can actually reach. Per function rather than shared, because the
 * domains differ: a cosine distance is bounded on `[0, 2]` and its score on
 * `[-1, 1]`, an `l2` score is positive, and `<#>` runs *negative* for the
 * positively-aligned vectors that are inner product's normal regime.
 *
 * Every pair here is required to straddle its bound — see the anti-vacuity
 * test below — so a score outside a function's reachable range does not belong
 * in this table. The bounds that legitimately exclude nothing are pinned
 * separately.
 */
const CASES: Record<
  VectorDistanceFunction,
  { readonly distances: readonly number[]; readonly minScores: readonly number[] }
> = {
  cosine: {
    distances: [0, 0.25, 0.5, 1, 1.5, 2],
    minScores: [-0.5, 0, 0.25, 0.5, 0.9, 1],
  },
  l2: {
    distances: [0, 0.25, 0.5, 1, 1.5, 2, 7],
    minScores: [0.25, 0.5, 0.9, 1],
  },
  inner_product: {
    distances: [-7, -3, -1, -0.5, 0, 0.5, 1, 3],
    minScores: [-1, -0.5, 0, 0.5, 1, 3],
  },
}

describe('the score bound', () => {
  test('agrees with the score for every distance and every function', () => {
    // The claim `minScore` is lowered on: `score >= minScore` and
    // `distance <= bound` select the same rows, which is what lets the bound
    // sit inside the query instead of filtering the result (ADR-0045).
    for (const fn of VECTOR_DISTANCE_FUNCTIONS) {
      for (const minScore of CASES[fn].minScores) {
        const bound = minScoreToDistanceBound(fn, minScore)
        for (const distance of CASES[fn].distances) {
          const scored = distanceToScore(fn, distance) >= minScore
          expect(bound === null ? true : distance <= bound).toBe(scored)
        }
      }
    }
  })

  test('every swept bound splits its distances, so no assertion above is hollow', () => {
    // An equivalence between two predicates that are false for every fixture
    // holds trivially. Requiring each bound to admit at least one distance and
    // exclude at least one is what stops the sweep passing on a fixture that
    // never reaches the range a function actually operates in — which is how
    // an all-non-negative fixture silently proved nothing about `<#>`.
    for (const fn of VECTOR_DISTANCE_FUNCTIONS) {
      for (const minScore of CASES[fn].minScores) {
        const bound = minScoreToDistanceBound(fn, minScore)
        expect(bound, `${fn} at minScore ${minScore} bounds nothing`).not.toBeNull()
        if (bound === null) continue
        const admitted = CASES[fn].distances.filter((distance) => distance <= bound)
        const excluded = CASES[fn].distances.filter((distance) => distance > bound)
        expect(admitted.length, `${fn} at minScore ${minScore} admits no distance`).toBeGreaterThan(
          0,
        )
        expect(
          excluded.length,
          `${fn} at minScore ${minScore} excludes no distance`,
        ).toBeGreaterThan(0)
      }
    }
  })

  test('is null only where it would exclude nothing', () => {
    expect(minScoreToDistanceBound('l2', 0)).toBeNull()
    expect(minScoreToDistanceBound('l2', -1)).toBeNull()
    expect(minScoreToDistanceBound('cosine', -1)).toBeNull()
    expect(minScoreToDistanceBound('cosine', -3)).toBeNull()
    expect(minScoreToDistanceBound('l2', 0.5)).toBeCloseTo(1, 10)
    expect(minScoreToDistanceBound('cosine', 0.9)).toBeCloseTo(0.1, 10)
    expect(minScoreToDistanceBound('inner_product', 3)).toBeCloseTo(-3, 10)
    expect(minScoreToDistanceBound('inner_product', -3)).toBeCloseTo(3, 10)
  })
})

describe('a declared distance function', () => {
  test('is recognised only for the functions this engine measures', () => {
    for (const fn of VECTOR_DISTANCE_FUNCTIONS) expect(isVectorDistanceFunction(fn)).toBe(true)
    expect(isVectorDistanceFunction('manhattan')).toBe(false)
    expect(isVectorDistanceFunction('COSINE')).toBe(false)
    expect(isVectorDistanceFunction(undefined)).toBe(false)
    expect(isVectorDistanceFunction(null)).toBe(false)
    expect(isVectorDistanceFunction(1)).toBe(false)
  })
})

describe('the distance', () => {
  test('measures what each function measures', () => {
    expect(vectorDistance('cosine', [1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 10)
    expect(vectorDistance('cosine', [0.6, 0.8, 0], [1, 0, 0])).toBeCloseTo(0.4, 10)
    expect(vectorDistance('l2', [3, 0, 0], [1, 0, 0])).toBeCloseTo(2, 10)
    expect(vectorDistance('inner_product', [3, 0.1, 0], [1, 0, 0])).toBeCloseTo(-3, 10)
  })

  test('runs negative for the aligned vectors inner product is used on', () => {
    // pgvector's `<#>` is the negated inner product, so the interesting range
    // is below zero and the score is its negation.
    const distance = vectorDistance('inner_product', [2, 1, 0], [1, 1, 0])
    expect(distance).toBeLessThan(0)
    expect(distanceToScore('inner_product', distance)).toBeCloseTo(3, 10)
  })

  test('is NaN against a zero vector, as pgvector reports it', () => {
    expect(vectorDistance('cosine', [0, 0, 0], [1, 0, 0])).toBeNaN()
  })
})

describe('a stored vector', () => {
  test('is read from an array of numbers', () => {
    expect(requireVector([1, 2, 3], 'Article', 'embedding')).toEqual([1, 2, 3])
  })

  test('raises rather than scoring NaN when the column does not decode', () => {
    // The search only scores rows whose column it proved present, so anything
    // but an array of numbers here is the engine misreading the column. A
    // silent NaN would be an undetectably wrong score on every row.
    for (const value of [null, '[1,2,3]', [1, 'two'], { 0: 1 }]) {
      expect(() => requireVector(value, 'Article', 'embedding')).toThrow(VectorDecodeError)
      expect(() => requireVector(value, 'Article', 'embedding')).toThrow(/"Article"\."embedding"/)
    }
  })
})
