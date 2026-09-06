import type { VectorStorage, SearchOptions } from './types.js'
import type { SearchResult } from '../config/types.js'
import type { SqliteVssStorageConfig } from '../config/types.js'
import { cosineSimilarity as calculateCosineSimilarity } from './types.js'
import { getDbKey } from '@opensaas/stack-core'

/**
 * SQLite storage backend for vector search.
 *
 * Known limit: does not issue native sqlite-vss virtual-table queries yet —
 * it always fetches candidate rows via Prisma and computes similarity in JS
 * (see `search`). Native VSS integration would require creating virtual
 * tables at schema-generation time.
 */
export class SqliteVssStorage implements VectorStorage {
  readonly type = 'sqlite-vss'
  private distanceFunction: 'cosine' | 'l2'

  constructor(config: SqliteVssStorageConfig) {
    this.distanceFunction = config.distanceFunction || 'cosine'
  }

  private distanceToScore(distance: number): number {
    if (this.distanceFunction === 'cosine') {
      return 1 - distance
    } else {
      return 1 / (1 + distance)
    }
  }

  async search<T = unknown>(
    listKey: string,
    fieldName: string,
    queryVector: number[],
    options: SearchOptions,
  ): Promise<SearchResult<T>[]> {
    const { limit = 10, minScore = 0.0, context, where = {} } = options

    const dbKey = getDbKey(listKey)
    const model = context.db[dbKey]

    if (!model) {
      throw new Error(`List '${listKey}' not found in context.db`)
    }

    try {
      const ormHandle = context.ormHandle

      if (!ormHandle) {
        console.warn(
          'sqlite-vss: Could not access Prisma client directly. ' +
            'Falling back to JSON-based search. ' +
            'For full sqlite-vss support, ensure the context exposes its ORM handle.',
        )
        return this.fallbackSearch(listKey, fieldName, queryVector, options)
      }

      const items = await model.findMany({
        where: {
          ...where,
          [fieldName]: {
            not: null,
          },
        },
      })

      const results: Array<{ item: T; score: number; distance: number }> = []

      for (const item of items) {
        const embeddingData = item[fieldName] as
          import('../config/types.js').StoredEmbedding | null | undefined

        if (!embeddingData || !embeddingData.vector) {
          continue
        }

        const storedVector = embeddingData.vector

        if (storedVector.length !== queryVector.length) {
          console.warn(
            `Vector dimension mismatch for ${listKey}.${item.id}.${fieldName}: ` +
              `expected ${queryVector.length}, got ${storedVector.length}. Skipping.`,
          )
          continue
        }

        let distance: number
        if (this.distanceFunction === 'cosine') {
          const similarity = this.cosineSimilarity(queryVector, storedVector)
          distance = 1 - similarity
        } else {
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

      results.sort((a, b) => b.score - a.score)

      return results.slice(0, limit)
    } catch (error) {
      throw new Error(
        `sqlite-vss search failed: ${(error as Error).message}\n` +
          'Ensure sqlite-vss extension is loaded in your SQLite connection.',
      )
    }
  }

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
