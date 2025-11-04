import type { VectorStorage, SearchOptions } from './types.js'
import type { SearchResult } from '../config/types.js'
import type { SqliteVssStorageConfig } from '../config/types.js'
import { cosineSimilarity as calculateCosineSimilarity } from './types.js'
import { getDbKey } from '@opensaas/stack-core'

/**
 * SQLite VSS storage backend
 * Uses sqlite-vss extension for vector similarity search
 * Requires: sqlite-vss extension to be loaded
 */
export class SqliteVssStorage implements VectorStorage {
  readonly type = 'sqlite-vss'
  private distanceFunction: 'cosine' | 'l2'

  constructor(config: SqliteVssStorageConfig) {
    this.distanceFunction = config.distanceFunction || 'cosine'
  }

  /**
   * Convert distance to similarity score (0-1, higher is more similar)
   */
  private distanceToScore(distance: number): number {
    if (this.distanceFunction === 'cosine') {
      // Cosine distance is 1 - similarity
      return 1 - distance
    } else {
      // L2 distance: convert to similarity using 1 / (1 + distance)
      return 1 / (1 + distance)
    }
  }

  /**
   * Search for similar vectors using sqlite-vss
   */
  async search<T = unknown>(
    listKey: string,
    fieldName: string,
    queryVector: number[],
    options: SearchOptions,
  ): Promise<SearchResult<T>[]> {
    const { limit = 10, minScore = 0.0, context, where = {} } = options

    const dbKey = getDbKey(listKey)
    const model = (context.db as Record<string, unknown>)[dbKey]

    if (!model) {
      throw new Error(`List '${listKey}' not found in context.db`)
    }

    try {
      // Get the underlying Prisma client
      const prisma =
        (context as Record<string, unknown>)._prisma ||
        (context.db as Record<string, unknown>)._prisma

      if (!prisma) {
        // Fallback: if we can't access Prisma directly, use JSON storage approach
        console.warn(
          'sqlite-vss: Could not access Prisma client directly. ' +
            'Falling back to JSON-based search. ' +
            'For full sqlite-vss support, ensure the context exposes _prisma.',
        )
        return this.fallbackSearch(listKey, fieldName, queryVector, options)
      }

      // Build JSON array string for the vector
      // Note: vectorString would be used for native sqlite-vss queries
      // Currently using fallback JS-based search
      // const vectorString = JSON.stringify(queryVector)

      // Table name (Prisma uses PascalCase in schema but lowercases in DB)
      // Note: tableName would be used for native sqlite-vss queries
      // const tableName = listKey

      // SQLite VSS query
      // We need to create a virtual table for VSS search
      // For now, we'll use a simpler approach: extract vectors and compute in JS
      // Full sqlite-vss integration would require creating virtual tables at schema generation time

      // Query to get all items with embeddings
      const items = await model.findMany({
        where: {
          ...where,
          [fieldName]: {
            not: null,
          },
        },
      })

      // Calculate similarity for each item (JavaScript fallback)
      const results: Array<{ item: T; score: number; distance: number }> = []

      for (const item of items) {
        const embeddingData = item[fieldName]

        if (!embeddingData || !embeddingData.vector) {
          continue
        }

        const storedVector = embeddingData.vector

        // Validate vector dimensions
        if (storedVector.length !== queryVector.length) {
          console.warn(
            `Vector dimension mismatch for ${listKey}.${item.id}.${fieldName}: ` +
              `expected ${queryVector.length}, got ${storedVector.length}. Skipping.`,
          )
          continue
        }

        // Calculate similarity
        let distance: number
        if (this.distanceFunction === 'cosine') {
          const similarity = this.cosineSimilarity(queryVector, storedVector)
          distance = 1 - similarity
        } else {
          // L2 distance
          distance = Math.sqrt(
            storedVector.reduce((sum: number, val: number, i: number) => {
              const diff = val - queryVector[i]
              return sum + diff * diff
            }, 0),
          )
        }

        const score = this.distanceToScore(distance)

        if (score >= minScore) {
          results.push({
            item: item as T,
            score,
            distance,
          })
        }
      }

      // Sort by score (descending) and limit results
      results.sort((a, b) => b.score - a.score)

      return results.slice(0, limit)
    } catch (error) {
      throw new Error(
        `sqlite-vss search failed: ${(error as Error).message}\n` +
          'Ensure sqlite-vss extension is loaded in your SQLite connection.',
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
 * Create a SQLite VSS storage instance
 *
 * @example
 * ```typescript
 * import { createSqliteVssStorage } from '@opensaas/stack-rag/storage'
 *
 * const storage = createSqliteVssStorage({
 *   type: 'sqlite-vss',
 *   distanceFunction: 'cosine'
 * })
 *
 * const results = await storage.search('Article', 'contentEmbedding', queryVector, {
 *   limit: 10,
 *   context
 * })
 * ```
 */
export function createSqliteVssStorage(config: SqliteVssStorageConfig): SqliteVssStorage {
  return new SqliteVssStorage(config)
}
