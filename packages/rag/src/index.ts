/**
 * @opensaas/stack-rag
 * RAG and AI embeddings integration for OpenSaas Stack
 */

// Config exports
export {
  openaiEmbeddings,
  ollamaEmbeddings,
  pgvectorStorage,
  sqliteVssStorage,
  jsonStorage,
} from './config/index.js'

// Plugin export
export { ragPlugin } from './config/plugin.js'

export type {
  RAGConfig,
  NormalizedRAGConfig,
  EmbeddingProviderConfig,
  OpenAIEmbeddingConfig,
  OllamaEmbeddingConfig,
  VectorStorageConfig,
  PgVectorStorageConfig,
  SqliteVssStorageConfig,
  JsonStorageConfig,
  ChunkingConfig,
  ChunkingStrategy,
  EmbeddingMetadata,
  StoredEmbedding,
  SearchResult,
  EmbeddingsIndex,
  EmbeddedDocument,
  EmbeddingChunk,
} from './config/types.js'
