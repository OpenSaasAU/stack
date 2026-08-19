import type { SearchResult } from '../config/types.js'

export interface VectorStorage {
  readonly type: string

  /**
   * @param listKey - The list name (e.g., 'Post', 'Article')
   * @param fieldName - The field name containing embeddings
   */
  search<T = unknown>(
    listKey: string,
    fieldName: string,
    queryVector: number[],
    options: SearchOptions,
  ): Promise<SearchResult<T>[]>

  /**
   * @returns Similarity score (0-1, higher is more similar).
   */
  cosineSimilarity(a: number[], b: number[]): number
}

export type SearchOptions = {
  /** @default 10 */
  limit?: number

  /**
   * Minimum similarity score (0-1).
   * @default 0.0
   */
  minScore?: number

  /**
   * Required so implementations enforce access control — callers must only
   * see items they have access to.
   */
  context: import('@opensaas/stack-core').AccessContext

  /**
   * Additional Prisma where clause, merged with the access control filter
   * (not a replacement for it).
   */
  where?: Record<string, unknown>

  /**
   * Required for implementations that enforce access control in raw SQL
   * queries (e.g. pgvector, sqlite-vss).
   */
  config?: import('@opensaas/stack-core').OpenSaasConfig
}

export type DistanceFunction = 'cosine' | 'l2' | 'inner_product'

export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return vector
  return vector.map((val) => val / magnitude)
}

export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }
  return a.reduce((sum, val, i) => sum + val * b[i], 0)
}

export function l2Distance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }
  const sumSquaredDiff = a.reduce((sum, val, i) => {
    const diff = val - b[i]
    return sum + diff * diff
  }, 0)
  return Math.sqrt(sumSquaredDiff)
}

/**
 * Returns a value between 0 and 1 (higher is more similar) — not the
 * standard -1 to 1 range.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const dotProd = dotProduct(a, b)
  const magnitudeA = Math.sqrt(dotProduct(a, a))
  const magnitudeB = Math.sqrt(dotProduct(b, b))

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0
  }

  // Cosine similarity ranges from -1 to 1
  // We normalize to 0-1 for consistency
  const similarity = dotProd / (magnitudeA * magnitudeB)
  return (similarity + 1) / 2
}
