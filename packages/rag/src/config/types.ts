/**
 * RAG (Retrieval-Augmented Generation) configuration types
 */

export type ChunkingStrategy = 'none' | 'recursive' | 'sentence' | 'sliding-window'

export type ChunkingConfig = {
  /** @default 'recursive' */
  strategy?: ChunkingStrategy
  /** @default 500 */
  maxTokens?: number
  /**
   * Only applies to 'recursive' and 'sliding-window' strategies.
   * @default 50
   */
  overlap?: number
}

export type EmbeddingProviderName = 'openai' | 'ollama' | string

export type OpenAIEmbeddingModel =
  'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002'

export type OpenAIEmbeddingConfig = {
  type: 'openai'
  apiKey: string
  /** @default 'text-embedding-3-small' */
  model?: OpenAIEmbeddingModel
  organization?: string
  /** For Azure or other custom-compatible endpoints. */
  baseURL?: string
}

export type OllamaEmbeddingConfig = {
  type: 'ollama'
  /** @default 'http://localhost:11434' */
  baseURL?: string
  /** @default 'nomic-embed-text' */
  model?: string
}

/**
 * For custom or third-party embedding providers not covered by
 * `OpenAIEmbeddingConfig` / `OllamaEmbeddingConfig`.
 */
export type CustomEmbeddingConfig = {
  type: string
  [key: string]: unknown
}

export type EmbeddingProviderConfig =
  OpenAIEmbeddingConfig | OllamaEmbeddingConfig | CustomEmbeddingConfig

export type VectorStorageBackend = 'pgvector' | 'sqlite-vss' | 'json' | string

export type PgVectorStorageConfig = {
  type: 'pgvector'
  /** @default 'cosine' */
  distanceFunction?: 'cosine' | 'l2' | 'inner_product'
}

export type SqliteVssStorageConfig = {
  type: 'sqlite-vss'
  /** @default 'cosine' */
  distanceFunction?: 'cosine' | 'l2'
}

/**
 * JSON-based storage — stores vectors as JSON, uses JavaScript for similarity
 * search. Good for development and small datasets.
 */
export type JsonStorageConfig = {
  type: 'json'
}

/** For custom vector storage backends not covered by the built-in ones. */
export type CustomStorageConfig = {
  type: string
  [key: string]: unknown
}

export type VectorStorageConfig =
  PgVectorStorageConfig | SqliteVssStorageConfig | JsonStorageConfig | CustomStorageConfig

export type BuildTimeConfig = {
  enabled: boolean

  /**
   * Relative to project root.
   * @default '.embeddings/embeddings.json'
   */
  outputPath?: string

  /**
   * In characters.
   * @default 500
   */
  chunkSize?: number

  /**
   * In characters.
   * @default 50
   */
  chunkOverlap?: number

  /**
   * Only regenerate embeddings for changed content.
   * @default true
   */
  differential?: boolean
}

export type RAGConfig = {
  /** Can be overridden per field via `providers`. */
  provider?: EmbeddingProviderConfig

  /**
   * Named embedding providers, allowing different providers for different
   * fields.
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

  /** @default { type: 'json' } */
  storage?: VectorStorageConfig

  /** Can be overridden per field. */
  chunking?: ChunkingConfig

  /**
   * When enabled, embeddings are generated at build time and stored in a
   * JSON file instead of being generated at runtime via hooks.
   */
  buildTime?: BuildTimeConfig

  /**
   * Requires MCP to be enabled in the main config.
   * @default true
   */
  enableMcpTools?: boolean

  /** @default 10 */
  batchSize?: number

  /** Requests per minute, for embedding API calls.
   * @default 100
   */
  rateLimit?: number
}

/** `RAGConfig` with all defaults resolved to concrete values. */
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

export type EmbeddingMetadata = {
  model: string
  /** e.g. 'openai', 'ollama' */
  provider: string
  dimensions: number
  generatedAt: string
  /** For detecting content changes. */
  sourceHash?: string
}

export type StoredEmbedding = {
  vector: number[]
  metadata: EmbeddingMetadata
}

export type SearchResult<T = unknown> = {
  item: T
  /** 0-1, higher is more similar. */
  score: number
  /** Depends on storage backend. */
  distance: number
}

/** Options for the `searchable()` field wrapper — a simplified subset of the full config for common use cases. */
export type SearchableOptions = {
  /**
   * References a provider name from the RAG config. Falls back to the
   * default provider if not specified.
   */
  provider?: EmbeddingProviderName

  /**
   * Must match the provider's output dimensions.
   * @default 1536 (OpenAI text-embedding-3-small)
   */
  dimensions?: number

  chunking?: ChunkingConfig

  /**
   * If not provided, defaults to `${fieldName}Embedding`.
   * @example 'contentVector' instead of 'contentEmbedding'
   */
  embeddingFieldName?: string
}

/**
 * Internal metadata attached to searchable fields, used by `ragPlugin` to
 * identify and inject embedding fields.
 * @internal
 */
export type SearchableMetadata = {
  embeddingFieldName: string
  provider?: EmbeddingProviderName
  dimensions?: number
  chunking?: ChunkingConfig
}

/** Used in build-time generation output. */
export type EmbeddingChunk = {
  text: string
  embedding: number[]
  metadata: {
    chunkIndex: number

    /** Character position in original text. */
    startOffset: number

    /** Character position in original text. */
    endOffset: number

    /** Title chunks receive boosted scoring during search. */
    isTitle?: boolean

    [key: string]: unknown
  }
}

/** Used in build-time generation output. */
export type EmbeddedDocument = {
  /** Document ID or slug. */
  id: string
  title?: string
  chunks: EmbeddingChunk[]
  embeddingMetadata: EmbeddingMetadata
  generatedAt: string
  /** For differential updates. */
  contentHash: string
}

export type EmbeddingsIndex = {
  version: string
  config: {
    provider: string
    model: string
    dimensions: number
    chunkSize: number
    chunkOverlap: number
  }
  documents: Record<string, EmbeddedDocument>
  generatedAt: string
}
