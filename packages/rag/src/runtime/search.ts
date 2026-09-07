/**
 * Semantic search over the secured surface's `nearest()` terminal.
 *
 * Nothing here builds a query: `nearest()` is core-owned, so the Access
 * Filter, Field Visibility, the `minScore` distance bound and the ranking all
 * live inside one scoped query (ADR-0045). This module turns text into a
 * vector and names the list.
 */

import type { AccessContext, Where } from '@opensaas/stack-core'
import type { SearchResult } from '../config/types.js'
import type { EmbeddingProvider } from '../providers/types.js'

function listFor(context: AccessContext, listKey: string) {
  const list = context.db[listKey]
  if (list === undefined) {
    throw new Error(`List "${listKey}" is not on this context's db surface`)
  }
  return list
}

function bounds(limit: number | undefined, minScore: number | undefined) {
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(minScore === undefined ? {} : { minScore }),
  }
}

export interface SemanticSearchOptions {
  listKey: string
  fieldName: string
  query: string
  provider: EmbeddingProvider
  context: AccessContext

  /** @default 10 */
  limit?: number

  /** Lowered to a distance bound inside the query, not filtered afterwards. */
  minScore?: number

  where?: Where
}

/**
 * Search a list by natural language: embed the query, then rank through
 * `nearest()`.
 *
 * @example
 * ```typescript
 * const results = await semanticSearch({
 *   listKey: 'Article',
 *   fieldName: 'contentEmbedding',
 *   query: 'articles about machine learning',
 *   provider: createEmbeddingProvider({ type: 'openai', apiKey: '...' }),
 *   context: await getContext(),
 *   limit: 10,
 *   minScore: 0.7,
 * })
 * ```
 */
export async function semanticSearch(
  options: SemanticSearchOptions,
): Promise<SearchResult<Record<string, unknown>>[]> {
  const { listKey, fieldName, query, provider, context, limit, minScore, where } = options

  const queryVector = await provider.embed(query)
  const list = listFor(context, listKey)
  const scoped = where === undefined ? list : list.where(where)

  return await scoped.nearest(fieldName, queryVector, bounds(limit, minScore))
}

export interface FindSimilarOptions {
  listKey: string
  fieldName: string
  itemId: string
  context: AccessContext

  /** @default 10 */
  limit?: number

  minScore?: number

  /** @default true */
  excludeSelf?: boolean

  where?: Where
}

/** The vector off a stored embedding, or `null` when the item carries none. */
function storedVector(item: Record<string, unknown>, fieldName: string): number[] | null {
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
 * const similar = await findSimilar({
 *   listKey: 'Article',
 *   fieldName: 'contentEmbedding',
 *   itemId: 'article-123',
 *   context: await getContext(),
 *   limit: 5,
 * })
 * ```
 */
export async function findSimilar(
  options: FindSimilarOptions,
): Promise<SearchResult<Record<string, unknown>>[]> {
  const {
    listKey,
    fieldName,
    itemId,
    context,
    limit,
    minScore,
    excludeSelf = true,
    where = {},
  } = options

  const list = listFor(context, listKey)
  const item = await list.where({ id: { equals: itemId } }).first()
  if (item === null) {
    throw new Error(`Item with id "${itemId}" not found in list "${listKey}"`)
  }

  const vector = storedVector(item, fieldName)
  if (vector === null) {
    throw new Error(`Item "${itemId}" does not have an embedding in field "${fieldName}"`)
  }

  const predicate = excludeSelf ? { ...where, id: { not: itemId } } : where
  return await list.where(predicate).nearest(fieldName, vector, bounds(limit, minScore))
}
