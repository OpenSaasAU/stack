import type { VectorStorage, SearchOptions } from './types.js'
import type { SearchResult, StoredEmbedding } from '../config/types.js'
import { cosineSimilarity as calculateCosineSimilarity } from './types.js'
import { getDbKey } from '@opensaas/stack-core'

export class JsonVectorStorage implements VectorStorage {
  readonly type = 'json'

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

    // No `take` here — limit is applied after scoring below, so trimming the
    // query would cut candidates before ranking.
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
      const embeddingData = item[fieldName] as StoredEmbedding | null

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

      const score = this.cosineSimilarity(queryVector, storedVector)

      if (score >= minScore) {
        results.push({
          item: item as T,
          score,
          distance: 1 - score,
        })
      }
    }

    results.sort((a, b) => b.score - a.score)

    return results.slice(0, limit)
  }

  cosineSimilarity(a: number[], b: number[]): number {
    return calculateCosineSimilarity(a, b)
  }
}

/**
 * Create a JSON vector storage instance
 *
 * @example
 * ```typescript
 * import { createJsonStorage } from '@opensaas/stack-rag/storage'
 *
 * const storage = createJsonStorage()
 * const results = await storage.search('Article', 'contentEmbedding', queryVector, {
 *   limit: 10,
 *   context
 * })
 * ```
 */
export function createJsonStorage(): JsonVectorStorage {
  return new JsonVectorStorage()
}
