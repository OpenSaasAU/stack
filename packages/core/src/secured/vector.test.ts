import { describe, expect, test } from 'vitest'
import {
  VECTOR_DISTANCE_FUNCTIONS,
  distanceToScore,
  minScoreToDistanceBound,
  readVector,
  vectorDistance,
} from './vector.js'

const DISTANCES = [0, 0.25, 0.5, 1, 1.5, 2, 7]

describe('the score bound', () => {
  test('agrees with the score for every distance and every function', () => {
    // The claim `minScore` is lowered on: `score >= minScore` and
    // `distance <= bound` select the same rows, which is what lets the bound
    // sit inside the query instead of filtering the result (ADR-0045).
    for (const fn of VECTOR_DISTANCE_FUNCTIONS) {
      for (const minScore of [-1, 0, 0.25, 0.5, 0.9, 1]) {
        const bound = minScoreToDistanceBound(fn, minScore)
        for (const distance of DISTANCES) {
          const scored = distanceToScore(fn, distance) >= minScore
          expect(bound === null ? true : distance <= bound).toBe(scored)
        }
      }
    }
  })

  test('is null only where it would exclude nothing', () => {
    expect(minScoreToDistanceBound('l2', 0)).toBeNull()
    expect(minScoreToDistanceBound('l2', -1)).toBeNull()
    expect(minScoreToDistanceBound('l2', 0.5)).toBeCloseTo(1, 10)
    expect(minScoreToDistanceBound('cosine', 0.9)).toBeCloseTo(0.1, 10)
    expect(minScoreToDistanceBound('inner_product', 3)).toBeCloseTo(-3, 10)
  })
})

describe('the distance', () => {
  test('measures what each function measures', () => {
    expect(vectorDistance('cosine', [1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 10)
    expect(vectorDistance('cosine', [0.6, 0.8, 0], [1, 0, 0])).toBeCloseTo(0.4, 10)
    expect(vectorDistance('l2', [3, 0, 0], [1, 0, 0])).toBeCloseTo(2, 10)
    expect(vectorDistance('inner_product', [3, 0.1, 0], [1, 0, 0])).toBeCloseTo(-3, 10)
  })

  test('is NaN against a zero vector, as pgvector reports it', () => {
    expect(vectorDistance('cosine', [0, 0, 0], [1, 0, 0])).toBeNaN()
  })
})

describe('a stored vector', () => {
  test('is read only from an array of numbers', () => {
    expect(readVector([1, 2, 3])).toEqual([1, 2, 3])
    expect(readVector(null)).toBeNull()
    expect(readVector('[1,2,3]')).toBeNull()
    expect(readVector([1, 'two'])).toBeNull()
  })
})
