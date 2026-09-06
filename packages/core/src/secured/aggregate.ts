// The aggregate vocabulary: what `.aggregate()` may ask for, as data. Nothing
// here reaches the ORM — a resolved spec meets a collection in `read.ts`.
// See ADR-0041.

import { ValidationError } from '../hooks/index.js'

/**
 * One reducer an aggregate spec names. Opaque by construction: it carries the
 * reduction and nothing that could execute or widen the read.
 */
export interface CountReduction {
  readonly reduce: 'count'
}

/** The reducers `.aggregate(a => …)` hands the caller. */
export interface Aggregations {
  /**
   * How many rows this session may see. A denied read answers `0`,
   * indistinguishable from a genuinely empty scoped set (ADR-0041).
   */
  count(): CountReduction
}

/** An aggregate spec: one result key per reducer. */
export type AggregateSpec = Record<string, CountReduction>

/** What `.aggregate()` takes. */
export type AggregateBuild = (aggregations: Aggregations) => AggregateSpec

const COUNT: CountReduction = { reduce: 'count' }

/** The value `.aggregate()`'s callback is handed. */
export const aggregations: Aggregations = { count: () => COUNT }

/** The result keys a spec names, in the order it named them. */
export function specKeys(spec: AggregateSpec): string[] {
  return Object.keys(spec)
}

/**
 * Refuse a spec entry this engine did not hand out — most often a callback
 * that named a reducer the surface does not carry, which JavaScript would
 * otherwise hand on as `undefined` and the ORM would drop from the result.
 */
export function checkSpec(listName: string, spec: AggregateSpec): void {
  for (const [key, value] of Object.entries(spec)) {
    if (value !== COUNT) {
      throw new ValidationError([
        `Cannot aggregate "${listName}" as "${key}" — an aggregate spec takes the reducers the ` +
          `engine hands its callback, and count() is the only one it carries.`,
      ])
    }
  }
}

/** `0` under every key — what a denied aggregate answers (ADR-0041). */
export function zeroed(keys: readonly string[]): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, 0]))
}
