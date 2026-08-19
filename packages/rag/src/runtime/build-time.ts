/**
 * Build-time utilities for generating and managing embeddings
 * Used by CLI tools and custom build scripts
 */

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { EmbeddingProvider } from '../providers/types.js'
import type { EmbeddingsIndex, EmbeddedDocument, EmbeddingChunk } from '../config/types.js'

/**
 * Simpler than the runtime chunking strategies elsewhere in the package —
 * intended for build-time batch processing.
 */
export function simpleChunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap
  }

  return chunks
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Used for differential updates - only regenerate embeddings for changed content. */
export function loadExistingIndex(filePath: string): EmbeddingsIndex | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as EmbeddingsIndex
  } catch {
    console.warn(`Warning: Could not load existing embeddings from ${filePath}`)
    return null
  }
}

export async function generateDocumentEmbeddings(
  documentId: string,
  content: string,
  provider: EmbeddingProvider,
  options: {
    title?: string
    chunkSize: number
    chunkOverlap: number
    metadata?: Record<string, unknown>
  },
): Promise<EmbeddedDocument> {
  const { title, chunkSize, chunkOverlap, metadata = {} } = options

  const contentHash = hashContent(content)

  const allTextChunks: string[] = []
  const chunkTypes: Array<'title' | 'content'> = []

  if (title) {
    allTextChunks.push(title)
    chunkTypes.push('title')
  }

  const contentChunks = simpleChunkText(content, chunkSize, chunkOverlap)
  allTextChunks.push(...contentChunks)
  contentChunks.forEach(() => chunkTypes.push('content'))

  const allEmbeddings = await provider.embedBatch(allTextChunks)

  const chunks: EmbeddingChunk[] = []

  let embeddingIndex = 0
  let contentChunkIndex = 0

  for (let i = 0; i < chunkTypes.length; i++) {
    const type = chunkTypes[i]

    if (type === 'title') {
      chunks.push({
        text: allTextChunks[embeddingIndex],
        embedding: allEmbeddings[embeddingIndex],
        metadata: {
          chunkIndex: -1, // Special index for title
          startOffset: 0,
          endOffset: 0,
          isTitle: true,
          ...metadata,
        },
      })
    } else {
      chunks.push({
        text: allTextChunks[embeddingIndex],
        embedding: allEmbeddings[embeddingIndex],
        metadata: {
          chunkIndex: contentChunkIndex,
          startOffset: contentChunkIndex * (chunkSize - chunkOverlap),
          endOffset: Math.min(
            (contentChunkIndex + 1) * chunkSize - contentChunkIndex * chunkOverlap,
            content.length,
          ),
          ...metadata,
        },
      })
      contentChunkIndex++
    }

    embeddingIndex++
  }

  return {
    id: documentId,
    title,
    chunks,
    embeddingMetadata: {
      model: provider.model,
      provider: provider.type,
      dimensions: provider.dimensions,
      generatedAt: new Date().toISOString(),
    },
    generatedAt: new Date().toISOString(),
    contentHash,
  }
}
