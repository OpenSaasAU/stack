import type { VectorStorage, SearchOptions } from './types.js'
import type { SearchResult } from '../config/types.js'
import type { PgVectorStorageConfig } from '../config/types.js'
import { cosineSimilarity as calculateCosineSimilarity } from './types.js'
import { getDbKey } from '@opensaas/stack-core'

/**
 * pgvector storage backend
 * Uses PostgreSQL with pgvector extension for efficient vector similarity search
 * Requires: CREATE EXTENSION vector;
 */
export class PgVectorStorage implements VectorStorage {
  readonly type = 'pgvector'
  private distanceFunction: 'cosine' | 'l2' | 'inner_product'

  constructor(config: PgVectorStorageConfig) {
    this.distanceFunction = config.distanceFunction || 'cosine'
  }

  /**
   * Get the appropriate distance operator for pgvector
   */
  private getDistanceOperator(): string {
    switch (this.distanceFunction) {
      case 'cosine':
        return '<=>' // Cosine distance
      case 'l2':
        return '<->' // L2 distance
      case 'inner_product':
        return '<#>' // Inner product (negative, so smaller is more similar)
      default:
        return '<=>' // Default to cosine
    }
  }

  /**
   * Convert distance to similarity score (0-1, higher is more similar)
   */
  private distanceToScore(distance: number): number {
    switch (this.distanceFunction) {
      case 'cosine':
        // Cosine distance is 1 - similarity, so similarity = 1 - distance
        return 1 - distance
      case 'l2':
        // L2 distance: convert to similarity using 1 / (1 + distance)
        return 1 / (1 + distance)
      case 'inner_product':
        // Inner product: larger (less negative) is more similar
        // Convert to 0-1 range
        return -distance
      default:
        return 1 - distance
    }
  }

  /**
   * Search for similar vectors using pgvector
   */
  async search<T = unknown>(
    listKey: string,
    fieldName: string,
    queryVector: number[],
    options: SearchOptions,
  ): Promise<SearchResult<T>[]> {
    const { limit = 10, minScore = 0.0, context, where = {} } = options

    const dbKey = getDbKey(listKey)
    const model = (context.db as any)[dbKey]

    if (!model) {
      throw new Error(`List '${listKey}' not found in context.db`)
    }

    const distanceOp = this.getDistanceOperator()

    // Build the vector string for Prisma raw query
    // pgvector expects vectors in format: '[1,2,3]'
    const vectorString = `[${queryVector.join(',')}]`

    // We need to use Prisma.$queryRaw to access pgvector operators
    // The access-controlled context.db doesn't expose $queryRaw directly,
    // so we need to use a two-step approach:
    // 1. Get all matching IDs using raw query
    // 2. Fetch full items via access-controlled context

    try {
      // Get the underlying Prisma client
      // Note: This bypasses access control for the similarity search,
      // but we enforce it in the second query
      const prisma = (context as any)._prisma || (context.db as any)._prisma

      if (!prisma) {
        // Fallback: if we can't access Prisma directly, use JSON storage approach
        console.warn(
          'pgvector: Could not access Prisma client directly. ' +
            'Falling back to JSON-based search. ' +
            'For full pgvector support, ensure the context exposes _prisma.',
        )
        return this.fallbackSearch(listKey, fieldName, queryVector, options)
      }

      // Raw query to get IDs and distances
      // We extract the vector from the JSON field and cast it to vector type
      const tableName = listKey.toLowerCase() // Prisma table names are lowercase
      const results: Array<{ id: string; distance: number }> = await prisma.$queryRawUnsafe(`
        SELECT id,
               (("${fieldName}"->>'vector')::vector ${distanceOp} '${vectorString}'::vector) as distance
        FROM "${tableName}"
        WHERE "${fieldName}" IS NOT NULL
          AND "${fieldName}"->>'vector' IS NOT NULL
        ORDER BY distance
        LIMIT ${limit * 2}
      `)

      // Get IDs of items within score threshold
      const itemIds = results
        .map((r) => ({
          id: r.id,
          distance: Number(r.distance),
          score: this.distanceToScore(Number(r.distance)),
        }))
        .filter((r) => r.score >= minScore)
        .slice(0, limit)
        .map((r) => ({ id: r.id, distance: r.distance, score: r.score }))

      if (itemIds.length === 0) {
        return []
      }

      // Fetch full items via access-controlled context
      const items = await model.findMany({
        where: {
          ...where,
          id: {
            in: itemIds.map((r) => r.id),
          },
        },
      })

      // Match items with their scores and sort by score
      const searchResults: SearchResult<T>[] = []
      for (const idInfo of itemIds) {
        const item = items.find((i: any) => i.id === idInfo.id)
        if (item) {
          searchResults.push({
            item: item as T,
            score: idInfo.score,
            distance: idInfo.distance,
          })
        }
      }

      return searchResults
    } catch (error) {
      throw new Error(
        `pgvector search failed: ${(error as Error).message}\n` +
          'Ensure pgvector extension is installed: CREATE EXTENSION vector;',
      )
    }
  }

  /**
   * Fallback to JSON-based search if we can't access Prisma directly
   */
  private async fallbackSearch<T = unknown>(
    listKey: string,
    fieldName: string,
    queryVector: number[],
    options: SearchOptions,
  ): Promise<SearchResult<T>[]> {
    const { JsonVectorStorage } = await import('./json.js')
    const jsonStorage = new JsonVectorStorage()
    return jsonStorage.search(listKey, fieldName, queryVector, options)
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    return calculateCosineSimilarity(a, b)
  }
}

/**
 * Create a pgvector storage instance
 *
 * @example
 * ```typescript
 * import { createPgVectorStorage } from '@opensaas/stack-rag/storage'
 *
 * const storage = createPgVectorStorage({
 *   type: 'pgvector',
 *   distanceFunction: 'cosine'
 * })
 *
 * const results = await storage.search('Article', 'contentEmbedding', queryVector, {
 *   limit: 10,
 *   context
 * })
 * ```
 */
export function createPgVectorStorage(config: PgVectorStorageConfig): PgVectorStorage {
  return new PgVectorStorage(config)
}
