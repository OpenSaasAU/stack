/**
 * High-level embedding generation utilities
 */

import type { EmbeddingProvider } from '../providers/types.js'
import type { StoredEmbedding, EmbeddingMetadata } from '../config/types.js'
import { chunkText, type ChunkingOptions, type TextChunk } from './chunking.js'
import { createHash } from 'node:crypto'

export interface GenerateEmbeddingOptions {
  /**
   * Embedding provider to use
   */
  provider: EmbeddingProvider

  /**
   * Text to embed
   */
  text: string

  /**
   * Whether to enable text chunking for long documents
   * @default false
   */
  enableChunking?: boolean

  /**
   * Chunking configuration (only used if enableChunking is true)
   */
  chunking?: ChunkingOptions

  /**
   * Whether to include source hash in metadata for change detection
   * @default true
   */
  includeSourceHash?: boolean

  /**
   * Additional metadata to include
   */
  metadata?: Record<string, unknown>
}

export interface ChunkedEmbedding {
  /**
   * The chunk information
   */
  chunk: TextChunk

  /**
   * The stored embedding for this chunk
   */
  embedding: StoredEmbedding
}

/**
 * Generate embedding for text with automatic chunking support
 *
 * For single embeddings (no chunking), returns a StoredEmbedding.
 * For chunked text, returns an array of ChunkedEmbeddings.
 *
 * @example
 * ```typescript
 * // Simple embedding
 * const embedding = await generateEmbedding({
 *   provider: createEmbeddingProvider({ type: 'openai', apiKey: '...' }),
 *   text: 'Hello world',
 * })
 *
 * // Chunked embedding for long text
 * const chunks = await generateEmbedding({
 *   provider: createEmbeddingProvider({ type: 'openai', apiKey: '...' }),
 *   text: longDocument,
 *   enableChunking: true,
 *   chunking: { chunkSize: 1000, chunkOverlap: 200 },
 * })
 * ```
 */
// Overload signatures

export function generateEmbedding(
  options: GenerateEmbeddingOptions & { enableChunking: true },
): Promise<ChunkedEmbedding[]>
// eslint-disable-next-line no-redeclare
export function generateEmbedding(
  options: GenerateEmbeddingOptions & { enableChunking?: false },
): Promise<StoredEmbedding>
// eslint-disable-next-line no-redeclare
export function generateEmbedding(
  options: GenerateEmbeddingOptions,
): Promise<StoredEmbedding | ChunkedEmbedding[]>
// Implementation
// eslint-disable-next-line no-redeclare
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

  // Generate base metadata
  const baseMetadata: EmbeddingMetadata = {
    model: provider.model,
    provider: provider.type,
    dimensions: provider.dimensions,
    generatedAt: new Date().toISOString(),
    sourceHash,
  }

  // Without chunking, generate single embedding
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

  // With chunking, split text and generate embeddings for each chunk
  const chunks = chunkText(text, chunking)

  // Extract chunk texts
  const chunkTexts = chunks.map((c) => c.text)

  // Generate embeddings for all chunks in batch
  const vectors = await provider.embedBatch(chunkTexts)

  // Combine chunks with their embeddings
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
  /**
   * Embedding provider to use
   */
  provider: EmbeddingProvider

  /**
   * Array of texts to embed
   */
  texts: string[]

  /**
   * Whether to include source hash in metadata for change detection
   * @default true
   */
  includeSourceHash?: boolean

  /**
   * Additional metadata to include for all embeddings
   */
  metadata?: Record<string, unknown>

  /**
   * Batch size for embedding generation
   * @default 10
   */
  batchSize?: number
}

/**
 * Generate embeddings for multiple texts in batches
 *
 * More efficient than calling generateEmbedding() multiple times.
 * Automatically batches requests to respect API limits.
 *
 * @example
 * ```typescript
 * const embeddings = await generateEmbeddings({
 *   provider: createEmbeddingProvider({ type: 'openai', apiKey: '...' }),
 *   texts: ['text 1', 'text 2', 'text 3'],
 *   batchSize: 10,
 * })
 * ```
 */
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

  // Process in batches
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    // Generate embeddings for batch
    const vectors = await provider.embedBatch(batch)

    // Create StoredEmbedding objects
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

/**
 * Check if an embedding needs regeneration based on source text changes
 *
 * @param sourceText - Current source text
 * @param currentEmbedding - Existing embedding (if any)
 * @returns true if embedding needs regeneration
 */
export function shouldRegenerateEmbedding(
  sourceText: string,
  currentEmbedding: StoredEmbedding | null | undefined,
): boolean {
  // No existing embedding, needs generation
  if (!currentEmbedding) {
    return true
  }

  // No source hash in metadata, can't detect changes
  if (!currentEmbedding.metadata.sourceHash) {
    return false // Conservative: don't regenerate if we can't tell
  }

  // Compare source hash
  const currentHash = hashText(sourceText)
  return currentHash !== currentEmbedding.metadata.sourceHash
}

/**
 * Hash text for change detection
 * Uses SHA-256 for consistent hashing
 */
export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Validate that embedding dimensions match expected dimensions
 *
 * @param embedding - The embedding to validate
 * @param expectedDimensions - Expected number of dimensions
 * @throws Error if dimensions don't match
 */
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

/**
 * Merge multiple embeddings into a single embedding
 * Uses average pooling by default
 *
 * Useful for combining chunk embeddings into a single document embedding.
 *
 * @param embeddings - Array of embeddings to merge
 * @param method - Merge method ('average' or 'max')
 * @returns Merged embedding
 */
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

  // Validate all embeddings have same dimensions
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
    // Average pooling
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
    // Max pooling
    mergedVector = new Array(dimensions).fill(-Infinity)

    for (const emb of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        mergedVector[i] = Math.max(mergedVector[i], emb.vector[i])
      }
    }
  }

  // Merge metadata (use first embedding's metadata)
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
