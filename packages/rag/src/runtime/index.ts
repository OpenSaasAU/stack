export {
  chunkText,
  estimateTokenCount,
  mergeSmallChunks,
  type ChunkingStrategy,
  type ChunkingOptions,
  type TextChunk,
} from './chunking.js'

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

export {
  semanticSearch,
  findSimilar,
  type SemanticSearchOptions,
  type FindSimilarOptions,
} from './search.js'

export {
  batchProcess,
  RateLimiter,
  ProcessingQueue,
  type BatchProcessOptions,
  type BatchProgress,
  type BatchError,
  type BatchProcessResult,
} from './batch.js'

export {
  simpleChunkText,
  hashContent,
  loadExistingIndex,
  generateDocumentEmbeddings,
} from './build-time.js'

export { stripMarkdown, extractMarkdownText } from './markdown.js'

export {
  createProviderFromEnv,
  getProviderConfigFromEnv,
  type ProviderType,
} from './provider-helpers.js'
