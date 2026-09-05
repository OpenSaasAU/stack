import type { VectorStorage, SearchOptions } from './types.js'
import type { SearchResult } from '../config/types.js'
import type { PgVectorStorageConfig } from '../config/types.js'
import { cosineSimilarity as calculateCosineSimilarity } from './types.js'
import { getDbKey } from '@opensaas/stack-core'
import { buildAccessControlFilter, mergeAccessFilter, prismaFilterToSQL } from './access-filter.js'

/**
 * pgvector storage backend. Requires the Postgres `vector` extension: `CREATE EXTENSION vector;`
 */
export class PgVectorStorage implements VectorStorage {
  readonly type = 'pgvector'
  private distanceFunction: 'cosine' | 'l2' | 'inner_product'

  constructor(config: PgVectorStorageConfig) {
    this.distanceFunction = config.distanceFunction || 'cosine'
  }

  private getDistanceOperator(): string {
    switch (this.distanceFunction) {
      case 'cosine':
        return '<=>'
      case 'l2':
        return '<->'
      case 'inner_product':
        // pgvector's <#> returns the negative inner product, so smaller (more negative) is more similar.
        return '<#>'
      default:
        return '<=>'
    }
  }

  private distanceToScore(distance: number): number {
    switch (this.distanceFunction) {
      case 'cosine':
        return 1 - distance
      case 'l2':
        return 1 / (1 + distance)
      case 'inner_product':
        // Inverts pgvector's negative inner-product distance (see getDistanceOperator) so larger raw values score higher.
        return -distance
      default:
        return 1 - distance
    }
  }

  async search<T = unknown>(
    listKey: string,
    fieldName: string,
    queryVector: number[],
    options: SearchOptions,
  ): Promise<SearchResult<T>[]> {
    const { limit = 10, minScore = 0.0, context, where = {}, config } = options

    const dbKey = getDbKey(listKey)
    const model = context.db[dbKey]

    if (!model) {
      throw new Error(`List '${listKey}' not found in context.db`)
    }

    const distanceOp = this.getDistanceOperator()

    // pgvector expects vectors in the literal format '[1,2,3]'.
    const vectorString = `[${queryVector.join(',')}]`

    // $queryRawUnsafe bypasses context.db's built-in access control, so the access
    // filter below must be built and merged into the WHERE clause manually.

    try {
      const queryRawUnsafe = context.prisma?.$queryRawUnsafe

      if (typeof queryRawUnsafe !== 'function') {
        console.warn(
          'pgvector: Could not access Prisma client directly. ' +
            'Falling back to JSON-based search. ' +
            'For full pgvector support, ensure the context exposes prisma.',
        )
        return this.fallbackSearch(listKey, fieldName, queryVector, options)
      }

      let accessFilter = null
      if (config) {
        accessFilter = await buildAccessControlFilter(listKey, context, config)

        if (accessFilter === null) {
          return []
        }
      }

      const combinedFilter = accessFilter ? mergeAccessFilter(accessFilter, where) : where

      if (combinedFilter === null) {
        return []
      }

      const tableName = listKey // Prisma table names match the model name (PascalCase by default)
      const sqlWhereClause = prismaFilterToSQL(combinedFilter, tableName)

      const runRawQuery = queryRawUnsafe as (sql: string) => Promise<unknown>
      const results = (await runRawQuery(`
        SELECT id,
               (("${fieldName}"->>'vector')::vector ${distanceOp} '${vectorString}'::vector) as distance
        FROM "${tableName}"
        WHERE "${fieldName}" IS NOT NULL
          AND "${fieldName}"->>'vector' IS NOT NULL
          AND (${sqlWhereClause})
        ORDER BY distance
        LIMIT ${limit * 2}
      `)) as Array<{ id: string; distance: string }>

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

      // Refetch through the access-controlled context so field-level access control
      // and resolveOutput hooks apply to the returned items.
      const items = await model.findMany({
        where: {
          id: {
            in: itemIds.map((r) => r.id),
          },
        },
      })

      const searchResults: SearchResult<T>[] = []
      for (const idInfo of itemIds) {
        const item = items.find(
          (i: Record<string, unknown>) => (i as { id: string }).id === idInfo.id,
        )
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
