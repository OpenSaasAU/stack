/**
 * RAG (Retrieval-Augmented Generation) configuration types
 */

/**
 * Text chunking strategies for splitting documents
 */
export type ChunkingStrategy = 'none' | 'recursive' | 'sentence' | 'sliding-window'

/**
 * Chunking configuration options
 */
export type ChunkingConfig = {
  /**
   * Chunking strategy to use
   * @default 'recursive'
   */
  strategy?: ChunkingStrategy
  /**
   * Maximum tokens per chunk
   * @default 500
   */
  maxTokens?: number
  /**
   * Overlap between chunks (tokens)
   * Only applies to 'recursive' and 'sliding-window' strategies
   * @default 50
   */
  overlap?: number
}

/**
 * Embedding provider names
 */
export type EmbeddingProviderName = 'openai' | 'ollama' | string

/**
 * OpenAI embedding model options
 */
export type OpenAIEmbeddingModel =
  | 'text-embedding-3-small'
  | 'text-embedding-3-large'
  | 'text-embedding-ada-002'

/**
 * OpenAI embedding provider configuration
 */
export type OpenAIEmbeddingConfig = {
  type: 'openai'
  /**
   * OpenAI API key
   */
  apiKey: string
  /**
   * Model to use for embeddings
   * @default 'text-embedding-3-small'
   */
  model?: OpenAIEmbeddingModel
  /**
   * Organization ID (optional)
   */
  organization?: string
  /**
   * Base URL for API requests (optional, for Azure or custom endpoints)
   */
  baseURL?: string
}

/**
 * Ollama embedding provider configuration
 */
export type OllamaEmbeddingConfig = {
  type: 'ollama'
  /**
   * Ollama API endpoint
   * @default 'http://localhost:11434'
   */
  baseURL?: string
  /**
   * Model to use for embeddings
   * @default 'nomic-embed-text'
   */
  model?: string
}

/**
 * Generic embedding provider configuration
 * For custom or third-party providers
 */
export type CustomEmbeddingConfig = {
  type: string
  [key: string]: unknown
}

/**
 * Embedding provider configuration union
 */
export type EmbeddingProviderConfig =
  | OpenAIEmbeddingConfig
  | OllamaEmbeddingConfig
  | CustomEmbeddingConfig

/**
 * Vector storage backend types
 */
export type VectorStorageBackend = 'pgvector' | 'sqlite-vss' | 'json' | string

/**
 * pgvector storage configuration
 */
export type PgVectorStorageConfig = {
  type: 'pgvector'
  /**
   * Distance function for similarity search
   * @default 'cosine'
   */
  distanceFunction?: 'cosine' | 'l2' | 'inner_product'
}

/**
 * SQLite VSS storage configuration
 */
export type SqliteVssStorageConfig = {
  type: 'sqlite-vss'
  /**
   * Distance function for similarity search
   * @default 'cosine'
   */
  distanceFunction?: 'cosine' | 'l2'
}

/**
 * JSON-based storage (in-memory search)
 * Stores vectors as JSON and uses JavaScript for similarity search
 * Good for development and small datasets
 */
export type JsonStorageConfig = {
  type: 'json'
}

/**
 * Generic storage configuration for custom backends
 */
export type CustomStorageConfig = {
  type: string
  [key: string]: unknown
}

/**
 * Vector storage configuration union
 */
export type VectorStorageConfig =
  | PgVectorStorageConfig
  | SqliteVssStorageConfig
  | JsonStorageConfig
  | CustomStorageConfig

/**
 * Build-time embedding generation configuration
 */
export type BuildTimeConfig = {
  /**
   * Enable build-time embedding generation
   */
  enabled: boolean

  /**
   * Output path for embeddings JSON file
   * Relative to project root
   * @default '.embeddings/embeddings.json'
   */
  outputPath?: string

  /**
   * Chunk size for text splitting (in characters)
   * @default 500
   */
  chunkSize?: number

  /**
   * Overlap between chunks (in characters)
   * @default 50
   */
  chunkOverlap?: number

  /**
   * Whether to enable differential updates
   * Only regenerate embeddings for changed content
   * @default true
   */
  differential?: boolean
}

/**
 * Main RAG configuration
 */
export type RAGConfig = {
  /**
   * Default embedding provider
   * Can be overridden per field
   */
  provider?: EmbeddingProviderConfig

  /**
   * Named embedding providers
   * Allows using different providers for different fields
   *
   * @example
   * ```typescript
   * providers: {
   *   openai: openaiEmbeddings({ apiKey: '...' }),
   *   ollama: ollamaEmbeddings({ model: 'nomic-embed-text' })
   * }
   * ```
   */
  providers?: Record<string, EmbeddingProviderConfig>

  /**
   * Vector storage backend
   * @default { type: 'json' }
   */
  storage?: VectorStorageConfig

  /**
   * Default chunking configuration
   * Can be overridden per field
   */
  chunking?: ChunkingConfig

  /**
   * Build-time embedding generation configuration
   * When enabled, embeddings are generated at build time and stored in a JSON file
   * instead of being generated at runtime via hooks
   */
  buildTime?: BuildTimeConfig

  /**
   * Whether to enable MCP tools for semantic search
   * Requires MCP to be enabled in main config
   * @default true
   */
  enableMcpTools?: boolean

  /**
   * Batch size for embedding generation
   * @default 10
   */
  batchSize?: number

  /**
   * Rate limit (requests per minute) for embedding API calls
   * @default 100
   */
  rateLimit?: number
}

/**
 * Normalized RAG configuration with defaults applied
 */
export type NormalizedRAGConfig = {
  provider: EmbeddingProviderConfig | null
  providers: Record<string, EmbeddingProviderConfig>
  storage: VectorStorageConfig
  chunking: Required<ChunkingConfig>
  buildTime: Required<BuildTimeConfig> | null
  enableMcpTools: boolean
  batchSize: number
  rateLimit: number
}

/**
 * Embedding metadata stored alongside vectors
 */
export type EmbeddingMetadata = {
  /**
   * Embedding model used
   */
  model: string
  /**
   * Provider type (openai, ollama, etc.)
   */
  provider: string
  /**
   * Vector dimensions
   */
  dimensions: number
  /**
   * When the embedding was generated
   */
  generatedAt: string
  /**
   * Hash of source text (for detecting changes)
   */
  sourceHash?: string
}

/**
 * Stored embedding with vector and metadata
 */
export type StoredEmbedding = {
  /**
   * The embedding vector
   */
  vector: number[]
  /**
   * Metadata about the embedding
   */
  metadata: EmbeddingMetadata
}

/**
 * Semantic search result
 */
export type SearchResult<T = unknown> = {
  /**
   * The matching item
   */
  item: T
  /**
   * Similarity score (0-1, higher is more similar)
   */
  score: number
  /**
   * Distance metric (depends on storage backend)
   */
  distance: number
}

/**
 * Options for searchable() field wrapper
 * Simplified options for common use cases
 */
export type SearchableOptions = {
  /**
   * Embedding provider to use
   * References a provider name from RAG config
   * Falls back to default provider if not specified
   */
  provider?: EmbeddingProviderName

  /**
   * Vector dimensions
   * Must match the provider's output dimensions
   * @default 1536 (OpenAI text-embedding-3-small)
   */
  dimensions?: number

  /**
   * Chunking configuration for long texts
   */
  chunking?: ChunkingConfig

  /**
   * Custom name for the generated embedding field
   * If not provided, defaults to `${fieldName}Embedding`
   * @example 'contentVector' instead of 'contentEmbedding'
   */
  embeddingFieldName?: string
}

/**
 * Internal metadata attached to searchable fields
 * Used by ragPlugin to identify and inject embedding fields
 * @internal
 */
export type SearchableMetadata = {
  /**
   * Name for the generated embedding field
   */
  embeddingFieldName: string

  /**
   * Embedding provider to use
   */
  provider?: EmbeddingProviderName

  /**
   * Vector dimensions
   */
  dimensions?: number

  /**
   * Chunking configuration
   */
  chunking?: ChunkingConfig
}

/**
 * A chunk of text with its embedding
 * Used in build-time generation output
 */
export type EmbeddingChunk = {
  /**
   * The text content of this chunk
   */
  text: string

  /**
   * The embedding vector for this chunk
   */
  embedding: number[]

  /**
   * Metadata about the chunk
   */
  metadata: {
    /**
     * Index of this chunk within the document
     */
    chunkIndex: number

    /**
     * Start character position in original text
     */
    startOffset: number

    /**
     * End character position in original text
     */
    endOffset: number

    /**
     * Whether this chunk represents a document title
     * Title chunks receive boosted scoring during search
     */
    isTitle?: boolean

    /**
     * Additional custom metadata
     */
    [key: string]: unknown
  }
}

/**
 * Document with embeddings
 * Used in build-time generation output
 */
export type EmbeddedDocument = {
  /**
   * Document ID or slug
   */
  id: string

  /**
   * Document title
   */
  title?: string

  /**
   * The chunks of this document with embeddings
   */
  chunks: EmbeddingChunk[]

  /**
   * Embedding metadata
   */
  embeddingMetadata: EmbeddingMetadata

  /**
   * When the embeddings were generated
   */
  generatedAt: string

  /**
   * Hash of the source content (for differential updates)
   */
  contentHash: string
}

/**
 * Build-time embeddings index file format
 */
export type EmbeddingsIndex = {
  /**
   * Version of the embeddings format
   */
  version: string

  /**
   * Embedding configuration used to generate these embeddings
   */
  config: {
    provider: string
    model: string
    dimensions: number
    chunkSize: number
    chunkOverlap: number
  }

  /**
   * Documents with embeddings
   */
  documents: Record<string, EmbeddedDocument>

  /**
   * When the index was generated
   */
  generatedAt: string
}
