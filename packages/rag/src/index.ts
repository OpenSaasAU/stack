/**
 * @opensaas/stack-rag
 * RAG and AI embeddings integration for OpenSaas Stack
 */

// Config exports
export {
  withRAG,
  ragConfig,
  openaiEmbeddings,
  ollamaEmbeddings,
  pgvectorStorage,
  sqliteVssStorage,
  jsonStorage,
  getRAGConfig,
  getEmbeddingProvider,
} from './config/index.js'

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
} from './config/types.js'
