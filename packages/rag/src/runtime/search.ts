/**
 * High-level semantic search APIs
 */

import type { AccessContext } from '@opensaas/stack-core'
import type { SearchResult } from '../config/types.js'
import type { EmbeddingProvider } from '../providers/types.js'
import type { VectorStorage } from '../storage/types.js'

export interface SemanticSearchOptions {
  listKey: string
  fieldName: string
  query: string
  provider: EmbeddingProvider
  storage: VectorStorage
  context: AccessContext

  /** @default 10 */
  limit?: number

  /** @default 0.0 */
  minScore?: number

  where?: Record<string, unknown>
}

/**
 * Perform semantic search using natural language query. Embeds the query
 * text, then delegates to `storage.search()`, which also enforces access
 * control via `context`.
 *
 * @example
 * ```typescript
 * const results = await semanticSearch({
 *   listKey: 'Article',
 *   fieldName: 'contentEmbedding',
 *   query: 'articles about machine learning',
 *   provider: createEmbeddingProvider({ type: 'openai', apiKey: '...' }),
 *   storage: createVectorStorage({ type: 'pgvector' }),
 *   context: await getContext(),
 *   limit: 10,
 *   minScore: 0.7,
 * })
 * ```
 */
export async function semanticSearch<T = unknown>(
  options: SemanticSearchOptions,
): Promise<SearchResult<T>[]> {
  const {
    listKey,
    fieldName,
    query,
    provider,
    storage,
    context,
    limit = 10,
    minScore = 0.0,
    where,
  } = options

  const queryVector = await provider.embed(query)

  const results = await storage.search<T>(listKey, fieldName, queryVector, {
    limit,
    minScore,
    context,
    where,
  })

  return results
}

export interface FindSimilarOptions {
  listKey: string
  fieldName: string
  itemId: string
  storage: VectorStorage
  context: AccessContext

  /** @default 10 */
  limit?: number

  /** @default 0.0 */
  minScore?: number

  /** @default true */
  excludeSelf?: boolean

  where?: Record<string, unknown>
}

/**
 * Find items similar to a given item by ID. Fetches the source item's
 * embedding, then delegates to `storage.search()`, which also enforces
 * access control via `context`.
 *
 * @example
 * ```typescript
 * const similar = await findSimilar({
 *   listKey: 'Article',
 *   fieldName: 'contentEmbedding',
 *   itemId: 'article-123',
 *   storage: createVectorStorage({ type: 'pgvector' }),
 *   context: await getContext(),
 *   limit: 5,
 *   excludeSelf: true,
 * })
 * ```
 */
export async function findSimilar<T = unknown>(
  options: FindSimilarOptions,
): Promise<SearchResult<T>[]> {
  const {
    listKey,
    fieldName,
    itemId,
    storage,
    context,
    limit = 10,
    minScore = 0.0,
    excludeSelf = true,
    where = {},
  } = options

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (context.db as any)[listKey]

  if (!model) {
    throw new Error(`List "${listKey}" not found in database`)
  }

  const item = await model.findUnique({
    where: { id: itemId },
    select: { [fieldName]: true },
  })

  if (!item) {
    throw new Error(`Item with id "${itemId}" not found in list "${listKey}"`)
  }

  const embedding = item[fieldName]
  if (!embedding || !embedding.vector) {
    throw new Error(`Item "${itemId}" does not have an embedding in field "${fieldName}"`)
  }

  const queryVector = embedding.vector

  const searchWhere = excludeSelf ? { ...where, id: { not: itemId } } : where

  const results = await storage.search<T>(listKey, fieldName, queryVector, {
    limit,
    minScore,
    context,
    where: searchWhere,
  })

  return results
}
