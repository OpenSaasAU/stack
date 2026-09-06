// The vector vocabulary (ADR-0045): the arithmetic that turns a distance into
// a score, the inversion that turns a `minScore` into a distance bound, and
// the distance itself. Nothing here imports the ORM — the same rule the Where
// vocabulary is held to.

import type { VectorDistanceFunction } from '../config/types.js'

export type { VectorColumnDescriptor, VectorDistanceFunction } from '../config/types.js'

/** Every distance function a vector column may declare. */
export const VECTOR_DISTANCE_FUNCTIONS = ['cosine', 'l2', 'inner_product'] as const

export const VECTOR_DISTANCE_FUNCTION_SET: ReadonlySet<string> = new Set(VECTOR_DISTANCE_FUNCTIONS)

/**
 * A raw distance as the caller-facing score. Each function's distance runs the
 * opposite way to similarity, and `inner_product` runs *negatively* — pgvector's
 * `<#>` is the negated inner product — so the conversion is what stops a caller
 * having to know which direction this particular column counts in.
 */
export function distanceToScore(fn: VectorDistanceFunction, distance: number): number {
  switch (fn) {
    case 'cosine':
      return 1 - distance
    case 'l2':
      return 1 / (1 + distance)
    case 'inner_product':
      return -distance
  }
}

/**
 * The distance bound that expresses `score >= minScore`. Every supported
 * function is monotonically decreasing in the score, so the inversion is a
 * bound rather than a post-filter — which is what keeps top-K computed over the
 * rows the session may see (ADR-0045, spec #1123 story 32).
 *
 * `null` means the score bounds nothing: an `l2` score at or below zero is
 * satisfied by every distance, so adding a predicate would be noise.
 */
export function minScoreToDistanceBound(
  fn: VectorDistanceFunction,
  minScore: number,
): number | null {
  switch (fn) {
    case 'cosine':
      return 1 - minScore
    case 'l2':
      return minScore <= 0 ? null : 1 / minScore - 1
    case 'inner_product':
      return -minScore
  }
}

function dot(a: readonly number[], b: readonly number[]): number {
  let total = 0
  for (let i = 0; i < a.length; i++) total += a[i] * b[i]
  return total
}

/**
 * The distance between two vectors, in the same direction the database
 * measures it.
 *
 * This exists because a Prisma 8 collection at `8.0.0-rc.8` projects columns
 * and nothing else — an expression cannot be selected — so the ordering and
 * the bound are the database's and the returned number is recomputed here from
 * the row's own vector, which the session must be able to read to have got
 * this far. Both sides evaluate the same function over the same values.
 */
export function vectorDistance(
  fn: VectorDistanceFunction,
  a: readonly number[],
  b: readonly number[],
): number {
  switch (fn) {
    case 'cosine': {
      const norm = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b))
      return norm === 0 ? Number.NaN : 1 - dot(a, b) / norm
    }
    case 'l2': {
      let total = 0
      for (let i = 0; i < a.length; i++) total += (a[i] - b[i]) ** 2
      return Math.sqrt(total)
    }
    case 'inner_product':
      return -dot(a, b)
  }
}

/** A row's vector, as a read returns it, or `null` when the column is empty. */
export function readVector(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null
  return value.every((entry) => typeof entry === 'number') ? value : null
}
