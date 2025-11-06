/**
 * High-level semantic search APIs
 */

import type { AccessContext } from '@opensaas/stack-core'
import type { SearchResult } from '../config/types.js'
import type { EmbeddingProvider } from '../providers/types.js'
import type { VectorStorage } from '../storage/types.js'

export interface SemanticSearchOptions {
  /**
   * List key to search (e.g., 'Article', 'Post')
   */
  listKey: string

  /**
   * Field name containing embeddings
   */
  fieldName: string

  /**
   * Natural language query text
   */
  query: string

  /**
   * Embedding provider to use for query embedding
   */
  provider: EmbeddingProvider

  /**
   * Vector storage backend to use for search
   */
  storage: VectorStorage

  /**
   * Access context for enforcing access control
   */
  context: AccessContext

  /**
   * Maximum number of results to return
   * @default 10
   */
  limit?: number

  /**
   * Minimum similarity score (0-1)
   * @default 0.0
   */
  minScore?: number

  /**
   * Additional Prisma where clause to filter results
   */
  where?: Record<string, unknown>
}

/**
 * Perform semantic search using natural language query
 *
 * This is a high-level API that:
 * 1. Generates embedding for the query text
 * 2. Searches for similar vectors in the database
 * 3. Enforces access control
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

  // Generate embedding for query
  const queryVector = await provider.embed(query)

  // Search for similar vectors
  const results = await storage.search<T>(listKey, fieldName, queryVector, {
    limit,
    minScore,
    context,
    where,
  })

  return results
}

export interface FindSimilarOptions {
  /**
   * List key to search (e.g., 'Article', 'Post')
   */
  listKey: string

  /**
   * Field name containing embeddings
   */
  fieldName: string

  /**
   * ID of the item to find similar items for
   */
  itemId: string

  /**
   * Vector storage backend to use for search
   */
  storage: VectorStorage

  /**
   * Access context for enforcing access control
   */
  context: AccessContext

  /**
   * Maximum number of results to return
   * @default 10
   */
  limit?: number

  /**
   * Minimum similarity score (0-1)
   * @default 0.0
   */
  minScore?: number

  /**
   * Whether to exclude the source item from results
   * @default true
   */
  excludeSelf?: boolean

  /**
   * Additional Prisma where clause to filter results
   */
  where?: Record<string, unknown>
}

/**
 * Find items similar to a given item by ID
 *
 * This is a high-level API that:
 * 1. Fetches the embedding of the source item
 * 2. Searches for similar vectors in the database
 * 3. Enforces access control
 * 4. Optionally excludes the source item from results
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

  // Fetch the source item's embedding
  // We need to access the database through the context
  const dbKey = getDbKey(listKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (context.db as any)[dbKey]

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

  // Build where clause
  const searchWhere = excludeSelf ? { ...where, id: { not: itemId } } : where

  // Search for similar vectors
  const results = await storage.search<T>(listKey, fieldName, queryVector, {
    limit,
    minScore,
    context,
    where: searchWhere,
  })

  return results
}

/**
 * Convert list key (PascalCase) to database key (camelCase)
 * Same logic as in core package
 */
function getDbKey(listKey: string): string {
  return listKey.charAt(0).toLowerCase() + listKey.slice(1)
}
