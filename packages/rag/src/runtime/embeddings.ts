import type { EmbeddingProvider } from '../providers/types.js'
import type { StoredEmbedding, EmbeddingMetadata } from '../config/types.js'
import { chunkText, type ChunkingOptions, type TextChunk } from './chunking.js'
import { createHash } from 'node:crypto'

export interface GenerateEmbeddingOptions {
  provider: EmbeddingProvider

  text: string

  enableChunking?: boolean

  chunking?: ChunkingOptions

  includeSourceHash?: boolean

  metadata?: Record<string, unknown>
}

export interface ChunkedEmbedding {
  chunk: TextChunk

  embedding: StoredEmbedding
}

export function generateEmbedding(
  options: GenerateEmbeddingOptions & { enableChunking: true },
): Promise<ChunkedEmbedding[]>
export function generateEmbedding(
  options: GenerateEmbeddingOptions & { enableChunking?: false },
): Promise<StoredEmbedding>
export function generateEmbedding(
  options: GenerateEmbeddingOptions,
): Promise<StoredEmbedding | ChunkedEmbedding[]>
export async function generateEmbedding(
  options: GenerateEmbeddingOptions,
): Promise<StoredEmbedding | ChunkedEmbedding[]> {
  const {
    provider,
    text,
    enableChunking = false,
    chunking,
    includeSourceHash = true,
    metadata: additionalMetadata,
  } = options

  const sourceHash = includeSourceHash ? hashText(text) : undefined

  const baseMetadata: EmbeddingMetadata = {
    model: provider.model,
    provider: provider.type,
    dimensions: provider.dimensions,
    generatedAt: new Date().toISOString(),
    sourceHash,
  }

  if (!enableChunking) {
    const vector = await provider.embed(text)

    return {
      vector,
      metadata: {
        ...baseMetadata,
        ...additionalMetadata,
      },
    }
  }

  const chunks = chunkText(text, chunking)

  const chunkTexts = chunks.map((c) => c.text)

  const vectors = await provider.embedBatch(chunkTexts)

  const chunkedEmbeddings: ChunkedEmbedding[] = chunks.map((chunk, index) => ({
    chunk,
    embedding: {
      vector: vectors[index],
      metadata: {
        ...baseMetadata,
        ...additionalMetadata,
        chunkIndex: index,
        chunkStart: chunk.start,
        chunkEnd: chunk.end,
      },
    },
  }))

  return chunkedEmbeddings
}

export interface GenerateEmbeddingsOptions {
  provider: EmbeddingProvider

  texts: string[]

  includeSourceHash?: boolean

  metadata?: Record<string, unknown>

  batchSize?: number
}

export async function generateEmbeddings(
  options: GenerateEmbeddingsOptions,
): Promise<StoredEmbedding[]> {
  const {
    provider,
    texts,
    includeSourceHash = true,
    metadata: additionalMetadata,
    batchSize = 10,
  } = options

  const baseMetadata: Omit<EmbeddingMetadata, 'sourceHash'> = {
    model: provider.model,
    provider: provider.type,
    dimensions: provider.dimensions,
    generatedAt: new Date().toISOString(),
  }

  const embeddings: StoredEmbedding[] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    const vectors = await provider.embedBatch(batch)

    for (let j = 0; j < batch.length; j++) {
      const text = batch[j]
      const vector = vectors[j]
      const sourceHash = includeSourceHash ? hashText(text) : undefined

      embeddings.push({
        vector,
        metadata: {
          ...baseMetadata,
          sourceHash,
          ...additionalMetadata,
        },
      })
    }
  }

  return embeddings
}

export function shouldRegenerateEmbedding(
  sourceText: string,
  currentEmbedding: StoredEmbedding | null | undefined,
): boolean {
  if (!currentEmbedding) {
    return true
  }

  if (!currentEmbedding.metadata.sourceHash) {
    return false // Conservative: don't regenerate if we can't tell
  }

  const currentHash = hashText(sourceText)
  return currentHash !== currentEmbedding.metadata.sourceHash
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function validateEmbeddingDimensions(
  embedding: StoredEmbedding,
  expectedDimensions: number,
): void {
  const actualDimensions = embedding.vector.length

  if (actualDimensions !== expectedDimensions) {
    throw new Error(
      `Embedding dimension mismatch: expected ${expectedDimensions}, got ${actualDimensions}. ` +
        `Provider: ${embedding.metadata.provider}, Model: ${embedding.metadata.model}`,
    )
  }

  if (embedding.metadata.dimensions !== actualDimensions) {
    throw new Error(
      `Embedding metadata dimension mismatch: metadata says ${embedding.metadata.dimensions}, ` +
        `but vector has ${actualDimensions} dimensions`,
    )
  }
}

export function mergeEmbeddings(
  embeddings: StoredEmbedding[],
  method: 'average' | 'max' = 'average',
): StoredEmbedding {
  if (embeddings.length === 0) {
    throw new Error('Cannot merge empty array of embeddings')
  }

  if (embeddings.length === 1) {
    return embeddings[0]
  }

  const dimensions = embeddings[0].vector.length
  for (const emb of embeddings) {
    if (emb.vector.length !== dimensions) {
      throw new Error(
        `Cannot merge embeddings with different dimensions: ${dimensions} vs ${emb.vector.length}`,
      )
    }
  }

  let mergedVector: number[]

  if (method === 'average') {
    mergedVector = new Array(dimensions).fill(0)

    for (const emb of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        mergedVector[i] += emb.vector[i]
      }
    }

    for (let i = 0; i < dimensions; i++) {
      mergedVector[i] /= embeddings.length
    }
  } else {
    mergedVector = new Array(dimensions).fill(-Infinity)

    for (const emb of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        mergedVector[i] = Math.max(mergedVector[i], emb.vector[i])
      }
    }
  }

  const firstMetadata = embeddings[0].metadata

  return {
    vector: mergedVector,
    metadata: {
      ...firstMetadata,
      generatedAt: new Date().toISOString(),
      mergedFrom: embeddings.length,
      mergeMethod: method,
    } as EmbeddingMetadata,
  }
}
