/**
 * Semantic search over the secured surface's `nearest()` terminal.
 *
 * Nothing here builds a query: `nearest()` is core-owned, so the Access
 * Filter, Field Visibility, the `minScore` distance bound and the ranking all
 * live inside one scoped query (ADR-0045). This module turns text into a
 * vector and hands it to a list the caller already named.
 */

import type { Where } from '@opensaas/stack-core'
import type { SearchResult } from '../config/types.js'
import type { EmbeddingProvider } from '../providers/types.js'

type Row = Record<string, unknown>

/**
 * The composed-read members these two functions drive.
 *
 * Structural rather than core's `SecuredQuery`, for the same reason
 * `RelationshipOptionsQuery` is: a generated project reaches its list as
 * `SecuredList<Contract, Remainder, K>`, which is *not* assignable to
 * `SecuredQuery` — `include`'s optional `refine` and `orderBy`'s array union
 * both fail the contravariance check. Naming only `where`, `nearest` and
 * `first` accepts the generated list and the engine's own delegate alike, and
 * infers `TRow` from whichever it is given.
 */
export interface SearchableList<TRow extends Row = Row> {
  where(predicate: Where): SearchableList<TRow>
  nearest(
    field: string,
    vector: readonly number[],
    options?: { limit?: number; minScore?: number },
  ): Promise<SearchResult<TRow>[]>
  first(): Promise<TRow | null>
}

function bounds(limit: number | undefined, minScore: number | undefined) {
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(minScore === undefined ? {} : { minScore }),
  }
}

export interface SemanticSearchOptions<TRow extends Row = Row> {
  /** The list to search, off the secured `db` surface: `context.db.Article`. */
  list: SearchableList<TRow>
  fieldName: string
  query: string
  provider: EmbeddingProvider

  /** @default 10 */
  limit?: number

  /**
   * Lowered to a distance bound inside the query, not filtered afterwards.
   *
   * The scale is the column's own distance function, not a normalised 0–1:
   * a `cosine` score is the raw cosine on `[-1, 1]`, an `l2` score is
   * `1 / (1 + distance)` on `(0, 1]`, and an `inner_product` score is the dot
   * product, which is unbounded.
   */
  minScore?: number

  where?: Where
}

/**
 * Search a list by natural language: embed the query, then rank through
 * `nearest()`.
 *
 * @example
 * ```typescript
 * const context = await getContext()
 *
 * const results = await semanticSearch({
 *   list: context.db.Article,
 *   fieldName: 'contentEmbedding',
 *   query: 'articles about machine learning',
 *   provider: createEmbeddingProvider({ type: 'openai', apiKey: '...' }),
 *   limit: 10,
 *   minScore: 0.25,
 * })
 * ```
 */
export async function semanticSearch<TRow extends Row = Row>(
  options: SemanticSearchOptions<TRow>,
): Promise<SearchResult<TRow>[]> {
  const { list, fieldName, query, provider, limit, minScore, where } = options

  const queryVector = await provider.embed(query)
  const scoped = where === undefined ? list : list.where(where)

  return await scoped.nearest(fieldName, queryVector, bounds(limit, minScore))
}

export interface FindSimilarOptions<TRow extends Row = Row> {
  /** The list to search, off the secured `db` surface: `context.db.Article`. */
  list: SearchableList<TRow>
  fieldName: string
  itemId: string

  /** @default 10 */
  limit?: number

  /** See {@link SemanticSearchOptions.minScore} for the scale. */
  minScore?: number

  /** @default true */
  excludeSelf?: boolean

  where?: Where
}

/** The vector off a stored embedding, or `null` when the item carries none. */
function storedVector(item: Row, fieldName: string): number[] | null {
  const stored: unknown = item[fieldName]
  if (stored === null || typeof stored !== 'object') return null
  const vector: unknown = Reflect.get(stored, 'vector')
  if (!Array.isArray(vector)) return null
  return vector.every((entry) => typeof entry === 'number') ? vector : null
}

/**
 * Find the items nearest a given item's own embedding.
 *
 * @example
 * ```typescript
 * const context = await getContext()
 *
 * const similar = await findSimilar({
 *   list: context.db.Article,
 *   fieldName: 'contentEmbedding',
 *   itemId: 'article-123',
 *   limit: 5,
 * })
 * ```
 */
export async function findSimilar<TRow extends Row = Row>(
  options: FindSimilarOptions<TRow>,
): Promise<SearchResult<TRow>[]> {
  const { list, fieldName, itemId, limit, minScore, excludeSelf = true, where = {} } = options

  const item = await list.where({ id: { equals: itemId } }).first()
  if (item === null) {
    throw new Error(`Item with id "${itemId}" was not found, or this session may not read it`)
  }

  const vector = storedVector(item, fieldName)
  if (vector === null) {
    throw new Error(`Item "${itemId}" does not have an embedding in field "${fieldName}"`)
  }

  const predicate = excludeSelf ? { ...where, id: { not: itemId } } : where
  return await list.where(predicate).nearest(fieldName, vector, bounds(limit, minScore))
}
