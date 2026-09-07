/**
 * @opensaas/stack-rag
 * RAG and AI embeddings integration for OpenSaas Stack
 */

export { openaiEmbeddings, ollamaEmbeddings } from './config/index.js'

export { ragPlugin } from './config/plugin.js'

export type { RAGRuntimeServices } from './runtime/types.js'

export type {
  RAGConfig,
  NormalizedRAGConfig,
  EmbeddingProviderConfig,
  OpenAIEmbeddingConfig,
  OllamaEmbeddingConfig,
  ChunkingConfig,
  ChunkingStrategy,
  EmbeddingMetadata,
  StoredEmbedding,
  SearchResult,
  EmbeddingsIndex,
  EmbeddedDocument,
  EmbeddingChunk,
} from './config/types.js'

export type {
  EmbeddingIndexConfig,
  ResolvedEmbeddingIndex,
  VectorColumnType,
  VectorIndexMethod,
} from './fields/embedding.js'
