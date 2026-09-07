import { existsSync, readFileSync } from 'node:fs'
import type { EmbeddingsIndex } from '@opensaas/stack-rag'

/**
 * A cosine scan over the build-time embeddings index the docs site ships
 * (`.embeddings/docs.json`, written by `scripts/generate-embeddings`).
 *
 * This is a flat file, not a database: there is no list, no session and no
 * access filter, so it has nothing to do with `nearest()`, which ranks a
 * scoped read over a native vector column.
 */
export interface DocsChunkMatch {
  documentId: string
  title?: string
  content: string
  chunkIndex: number
  metadata?: Record<string, unknown>
  score: number
}

let cached: EmbeddingsIndex | undefined

function loadIndex(filePath: string): EmbeddingsIndex {
  if (cached) return cached
  if (!existsSync(filePath)) {
    throw new Error(`Embeddings file not found: ${filePath}. Run embeddings generation first.`)
  }
  cached = JSON.parse(readFileSync(filePath, 'utf-8')) as EmbeddingsIndex
  return cached
}

function dot(a: readonly number[], b: readonly number[]): number {
  let total = 0
  for (let i = 0; i < a.length; i++) total += a[i] * b[i]
  return total
}

/** Cosine similarity mapped onto 0–1, the range the search UI renders. */
function similarity(a: readonly number[], b: readonly number[]): number {
  const norm = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b))
  if (norm === 0) return 0
  return (dot(a, b) / norm + 1) / 2
}

export function searchEmbeddings(
  filePath: string,
  queryVector: number[],
  options: { limit?: number; minScore?: number } = {},
): DocsChunkMatch[] {
  const { limit = 10, minScore = 0 } = options
  const index = loadIndex(filePath)

  if (queryVector.length !== index.config.dimensions) {
    throw new Error(
      `Query vector dimensions (${queryVector.length}) don't match index dimensions (${index.config.dimensions})`,
    )
  }

  const matches: DocsChunkMatch[] = []
  for (const [documentId, document] of Object.entries(index.documents)) {
    for (const chunk of document.chunks) {
      const score = similarity(queryVector, chunk.embedding)
      if (score < minScore) continue
      matches.push({
        documentId,
        title: document.title,
        content: chunk.text,
        chunkIndex: chunk.metadata.chunkIndex,
        metadata: chunk.metadata,
        score,
      })
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, limit)
}
