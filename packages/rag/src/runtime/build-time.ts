/**
 * Build-time utilities for generating and managing embeddings
 * Used by CLI tools and custom build scripts
 */

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { EmbeddingProvider } from '../providers/types.js'
import type { EmbeddingsIndex, EmbeddedDocument, EmbeddingChunk } from '../config/types.js'

/**
 * Simple character-based text chunking for build-time generation
 *
 * Simpler than the runtime chunking strategies, optimized for build-time batch processing.
 * Splits text into fixed-size chunks with overlap.
 *
 * @param text - Text to chunk
 * @param chunkSize - Size of each chunk in characters
 * @param overlap - Overlap between chunks in characters
 * @returns Array of text chunks
 *
 * @example
 * ```typescript
 * import { simpleChunkText } from '@opensaas/stack-rag/runtime'
 *
 * const chunks = simpleChunkText("Long document...", 500, 50)
 * ```
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

/**
 * Compute SHA256 hash of content for change detection
 *
 * @param content - Content to hash
 * @returns Hexadecimal hash string
 *
 * @example
 * ```typescript
 * import { hashContent } from '@opensaas/stack-rag/runtime'
 *
 * const hash = hashContent("document content")
 * ```
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Load existing embeddings index from file
 *
 * Used for differential updates - only regenerate embeddings for changed content.
 *
 * @param filePath - Path to embeddings JSON file
 * @returns Loaded index or null if file doesn't exist or can't be loaded
 *
 * @example
 * ```typescript
 * import { loadExistingIndex } from '@opensaas/stack-rag/runtime'
 *
 * const existing = loadExistingIndex('.embeddings/docs.json')
 * if (existing) {
 *   console.log(`Found ${Object.keys(existing.documents).length} existing documents`)
 * }
 * ```
 */
export function loadExistingIndex(filePath: string): EmbeddingsIndex | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as EmbeddingsIndex
  } catch (error) {
    console.warn(`Warning: Could not load existing embeddings from ${filePath}`)
    return null
  }
}

/**
 * Generate embeddings for a document with chunking
 *
 * Main utility for build-time embedding generation. Chunks the document,
 * generates embeddings for each chunk, and returns a complete EmbeddedDocument.
 *
 * @param documentId - Unique identifier for the document
 * @param content - Document content (plain text)
 * @param provider - Embedding provider instance
 * @param options - Generation options
 * @returns Complete embedded document ready to be added to index
 *
 * @example
 * ```typescript
 * import { generateDocumentEmbeddings } from '@opensaas/stack-rag/runtime'
 * import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
 *
 * const provider = createEmbeddingProvider({
 *   type: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY
 * })
 *
 * const doc = await generateDocumentEmbeddings(
 *   'docs/getting-started',
 *   'Document content here...',
 *   provider,
 *   {
 *     title: 'Getting Started',
 *     chunkSize: 500,
 *     chunkOverlap: 50,
 *     metadata: { section: 'guides' }
 *   }
 * )
 * ```
 */
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

  // Hash content for differential updates
  const contentHash = hashContent(content)

  // Prepare all text chunks to embed
  const allTextChunks: string[] = []
  const chunkTypes: Array<'title' | 'content'> = []

  // Add title chunk first if title exists
  if (title) {
    allTextChunks.push(title)
    chunkTypes.push('title')
  }

  // Chunk the content
  const contentChunks = simpleChunkText(content, chunkSize, chunkOverlap)
  allTextChunks.push(...contentChunks)
  contentChunks.forEach(() => chunkTypes.push('content'))

  // Generate embeddings in batch for all chunks
  const allEmbeddings = await provider.embedBatch(allTextChunks)

  // Build chunks with embeddings
  const chunks: EmbeddingChunk[] = []

  let embeddingIndex = 0
  let contentChunkIndex = 0

  for (let i = 0; i < chunkTypes.length; i++) {
    const type = chunkTypes[i]

    if (type === 'title') {
      // Title chunk
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
      // Content chunk
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
