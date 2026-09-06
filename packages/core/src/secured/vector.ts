// The vector vocabulary (ADR-0045): the arithmetic that turns a distance into
// a score, the inversion that turns a `minScore` into a distance bound, and
// the distance itself. Nothing here imports the ORM — the same rule the Where
// vocabulary is held to.

import type { VectorDistanceFunction } from '../config/types.js'

export type { VectorColumnDescriptor, VectorDistanceFunction } from '../config/types.js'

/** Every distance function a vector column may declare. */
export const VECTOR_DISTANCE_FUNCTIONS = ['cosine', 'l2', 'inner_product'] as const

const VECTOR_DISTANCE_FUNCTION_SET: ReadonlySet<string> = new Set(VECTOR_DISTANCE_FUNCTIONS)

/**
 * Whether a descriptor's declared distance function is one this engine
 * measures. `getVectorColumn` is a public extension point, so a third-party
 * field builder can name anything; an unrecognised value is refused at the
 * boundary rather than reaching the lowering as an absent template.
 */
export function isVectorDistanceFunction(value: unknown): value is VectorDistanceFunction {
  return typeof value === 'string' && VECTOR_DISTANCE_FUNCTION_SET.has(value)
}

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
 * `null` means the score bounds nothing, and each function has its own such
 * floor: an `l2` score is positive, and a cosine distance is bounded on
 * `[0, 2]` so a cosine score at or below `-1` admits every row. Adding a
 * predicate there would be noise.
 */
export function minScoreToDistanceBound(
  fn: VectorDistanceFunction,
  minScore: number,
): number | null {
  switch (fn) {
    case 'cosine':
      return minScore <= -1 ? null : 1 - minScore
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

/**
 * Thrown when a row's vector column does not read back as an array of numbers
 * — a codec or projection mismatch in the engine rather than a data condition,
 * since the search only scores rows whose column the query proved present.
 */
export class VectorDecodeError extends Error {
  constructor(
    readonly listName: string,
    readonly column: string,
  ) {
    super(
      `The vector column "${listName}"."${column}" did not read back as an array of numbers. ` +
        `The row matched a search that requires the column to be present, so this is a codec or ` +
        `projection mismatch rather than a missing value.`,
    )
    this.name = 'VectorDecodeError'
  }
}

/**
 * A row's vector, as a read returns it. Raises rather than yielding a score of
 * `NaN`: a wrong score is silently wrong ranking output the caller has no way
 * to detect.
 */
export function requireVector(value: unknown, listName: string, column: string): readonly number[] {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number')) return value
  throw new VectorDecodeError(listName, column)
}
