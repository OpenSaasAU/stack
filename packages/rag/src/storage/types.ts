import type { SearchResult } from '../config/types.js'

/**
 * Vector storage backend interface
 * All storage backends must implement this interface
 */
export interface VectorStorage {
  /**
   * Storage backend type
   */
  readonly type: string

  /**
   * Search for similar vectors
   *
   * @param listKey - The list name (e.g., 'Post', 'Article')
   * @param fieldName - The field name containing embeddings
   * @param queryVector - The query embedding vector
   * @param options - Search options
   * @returns Array of search results with items and scores
   */
  search<T = unknown>(
    listKey: string,
    fieldName: string,
    queryVector: number[],
    options: SearchOptions,
  ): Promise<SearchResult<T>[]>

  /**
   * Calculate cosine similarity between two vectors
   * Utility function for scoring results
   *
   * @param a - First vector
   * @param b - Second vector
   * @returns Similarity score (0-1, higher is more similar)
   */
  cosineSimilarity(a: number[], b: number[]): number
}

/**
 * Options for vector search
 */
export type SearchOptions = {
  /**
   * Maximum number of results to return
   * @default 10
   */
  limit?: number

  /**
   * Minimum similarity score (0-1)
   * Results below this threshold will be filtered out
   * @default 0.0
   */
  minScore?: number

  /**
   * Access context for enforcing access control
   * Required to ensure users only see items they have access to
   */
  context: import('@opensaas/stack-core').AccessContext

  /**
   * Additional Prisma where clause to filter results
   * This is merged with access control filters
   */
  where?: Record<string, unknown>
}

/**
 * Distance functions for vector similarity
 */
export type DistanceFunction = 'cosine' | 'l2' | 'inner_product'

/**
 * Normalize a vector to unit length
 * Required for cosine similarity
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return vector
  return vector.map((val) => val / magnitude)
}

/**
 * Calculate dot product of two vectors
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }
  return a.reduce((sum, val, i) => sum + val * b[i], 0)
}

/**
 * Calculate L2 (Euclidean) distance between two vectors
 */
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
 * Calculate cosine similarity between two vectors
 * Returns a value between 0 and 1 (higher is more similar)
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
