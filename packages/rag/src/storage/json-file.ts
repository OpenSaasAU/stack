import { readFileSync, existsSync } from 'node:fs'
import type { VectorStorage, SearchOptions } from './types.js'
import type { SearchResult, EmbeddingsIndex } from '../config/types.js'
import { cosineSimilarity as calculateCosineSimilarity } from './types.js'

export class JsonFileStorage implements VectorStorage {
  readonly type = 'json-file'

  private index: EmbeddingsIndex | null = null
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  private loadIndex(): EmbeddingsIndex {
    if (this.index) {
      return this.index
    }

    if (!existsSync(this.filePath)) {
      throw new Error(
        `Embeddings file not found: ${this.filePath}. Run embeddings generation first.`,
      )
    }

    try {
      const content = readFileSync(this.filePath, 'utf-8')
      this.index = JSON.parse(content) as EmbeddingsIndex
      return this.index
    } catch (error) {
      throw new Error(`Failed to load embeddings from ${this.filePath}: ${error}`)
    }
  }

  // listKey/fieldName are part of the VectorStorage interface (used by the
  // pgvector/sqlite-vss backends to scope per list/field) but unused here:
  // this backend searches one standalone embeddings file (e.g. docs).
  async search<T = unknown>(
    _listKey: string,
    _fieldName: string,
    queryVector: number[],
    options: SearchOptions,
  ): Promise<SearchResult<T>[]> {
    const { limit = 10, minScore = 0.0, where = {} } = options

    const index = this.loadIndex()

    if (queryVector.length !== index.config.dimensions) {
      throw new Error(
        `Query vector dimensions (${queryVector.length}) don't match index dimensions (${index.config.dimensions})`,
      )
    }

    const results: Array<{
      item: T
      score: number
      distance: number
      documentId: string
      chunkIndex: number
    }> = []

    for (const [documentId, document] of Object.entries(index.documents)) {
      if (where && Object.keys(where).length > 0) {
        let matches = true
        for (const [key, value] of Object.entries(where)) {
          if ((document as Record<string, unknown>)[key] !== value) {
            matches = false
            break
          }
        }
        if (!matches) continue
      }

      for (const chunk of document.chunks) {
        const score = this.cosineSimilarity(queryVector, chunk.embedding)

        if (score >= minScore) {
          results.push({
            item: {
              documentId,
              title: document.title,
              content: chunk.text,
              chunkIndex: chunk.metadata.chunkIndex,
              metadata: chunk.metadata,
            } as T,
            score,
            distance: 1 - score,
            documentId,
            chunkIndex: chunk.metadata.chunkIndex,
          })
        }
      }
    }

    results.sort((a, b) => b.score - a.score)

    return results.slice(0, limit)
  }

  cosineSimilarity(a: number[], b: number[]): number {
    return calculateCosineSimilarity(a, b)
  }

  getIndex(): EmbeddingsIndex | null {
    return this.index
  }

  reloadIndex(): void {
    this.index = null
    this.loadIndex()
  }
}

/**
 * @example
 * ```typescript
 * import { createJsonFileStorage } from '@opensaas/stack-rag/storage'
 *
 * const storage = createJsonFileStorage('.embeddings/docs.json')
 * const results = await storage.search('', '', queryVector, {
 *   limit: 10,
 *   minScore: 0.7
 * })
 * ```
 */
export function createJsonFileStorage(filePath: string): JsonFileStorage {
  return new JsonFileStorage(filePath)
}
