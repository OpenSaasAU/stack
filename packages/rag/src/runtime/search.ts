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
 * `first` accepts the generated list and the engine's own delegate alike.
 *
 * `nearest`'s `field` is declared as `string` here so this interface itself
 * stays a loose bound — a generic constraint, never instantiated on its own.
 * Core types the *real* `nearest` field as a literal union of that list's
 * vector columns (`never` for a list with none), and a caller's precise `L`
 * carries that literal union or `never` intact. `ListRow`/`ListField` below
 * read it back off `L` directly.
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

/**
 * The row a list's own `nearest()` returns, and the field name it actually
 * accepts — pattern-matched off `L`'s own `nearest` signature rather than
 * inferred through `SearchableList<TRow>` assignability.
 *
 * That distinction is the fix for
 * {@link https://github.com/OpenSaasAU/stack/issues/1303 | #1303}: method
 * syntax makes `SearchableList`'s own parameter comparison bivariant (needed
 * so a generated list — whose `include`/`orderBy` are not otherwise
 * assignable — still satisfies this interface as a constraint), and
 * bivariance is exactly what let a list with no vector column through: its
 * `nearest(field: never, …)` is bivariantly compatible with
 * `nearest(field: string, …)`, so inferring a type parameter *from that
 * assignability check* always lands on the parameter's declared bound
 * (`string`) rather than the list's real, narrower field type. Matching `L`
 * itself against a minimal `nearest` shape with `infer` sidesteps
 * assignability entirely: TypeScript reads the literal union (or `never`)
 * directly off `L`'s own method, so a list with no vector column makes
 * `ListField<L>` `never` and `fieldName` uncallable at the call site, exactly
 * as `context.db.<List>.nearest(...)` already refuses to compile.
 */
type ListRow<L extends SearchableList> = L extends {
  nearest(...args: never[]): Promise<SearchResult<infer R>[]>
}
  ? R
  : never

/** See {@link ListRow}. */
type ListField<L extends SearchableList> = L extends {
  nearest(field: infer F extends string, ...args: never[]): unknown
}
  ? F
  : never

function bounds(limit: number | undefined, minScore: number | undefined) {
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(minScore === undefined ? {} : { minScore }),
  }
}

export interface SemanticSearchOptions<L extends SearchableList = SearchableList> {
  /** The list to search, off the secured `db` surface: `context.db.Article`. */
  list: L
  /** One of `list`'s own vector columns — `never` when it declares none. */
  fieldName: ListField<L>
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
export async function semanticSearch<L extends SearchableList>(
  options: SemanticSearchOptions<L>,
): Promise<SearchResult<ListRow<L>>[]> {
  const { list, fieldName, query, provider, limit, minScore, where } = options

  const queryVector = await provider.embed(query)
  const scoped = where === undefined ? list : list.where(where)

  return (await scoped.nearest(fieldName, queryVector, bounds(limit, minScore))) as SearchResult<
    ListRow<L>
  >[]
}

export interface FindSimilarOptions<L extends SearchableList = SearchableList> {
  /** The list to search, off the secured `db` surface: `context.db.Article`. */
  list: L
  /** One of `list`'s own vector columns — `never` when it declares none. */
  fieldName: ListField<L>
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
export async function findSimilar<L extends SearchableList>(
  options: FindSimilarOptions<L>,
): Promise<SearchResult<ListRow<L>>[]> {
  const { list, fieldName, itemId, limit, minScore, excludeSelf = true, where = {} } = options

  const item = await list.where({ id: { equals: itemId } }).first()
  if (item === null) {
    throw new Error(`Item with id "${itemId}" was not found, or this session may not read it`)
  }

  const vector = storedVector(item, fieldName)
  if (vector === null) {
    throw new Error(`Item "${itemId}" does not have an embedding in field "${fieldName}"`)
  }

  const predicate = excludeSelf ? { AND: [where, { id: { not: itemId } }] } : where
  return (await list
    .where(predicate)
    .nearest(fieldName, vector, bounds(limit, minScore))) as SearchResult<ListRow<L>>[]
}
