/**
 * Runtime utilities for RAG operations
 *
 * This module provides high-level APIs for:
 * - Text chunking
 * - Embedding generation
 * - Semantic search
 * - Batch processing with rate limiting
 */

// Text chunking
export {
  chunkText,
  estimateTokenCount,
  mergeSmallChunks,
  type ChunkingStrategy,
  type ChunkingOptions,
  type TextChunk,
} from './chunking.js'

// Embedding generation
export {
  generateEmbedding,
  generateEmbeddings,
  shouldRegenerateEmbedding,
  hashText,
  validateEmbeddingDimensions,
  mergeEmbeddings,
  type GenerateEmbeddingOptions,
  type GenerateEmbeddingsOptions,
  type ChunkedEmbedding,
} from './embeddings.js'

// Semantic search
export {
  semanticSearch,
  findSimilar,
  type SemanticSearchOptions,
  type FindSimilarOptions,
} from './search.js'

// Batch processing
export {
  batchProcess,
  RateLimiter,
  ProcessingQueue,
  type BatchProcessOptions,
  type BatchProgress,
  type BatchError,
  type BatchProcessResult,
} from './batch.js'
