import type {
  RAGConfig,
  NormalizedRAGConfig,
  VectorStorageConfig,
  OpenAIEmbeddingConfig,
  OllamaEmbeddingConfig,
} from './types.js'

/**
 * Normalize RAG configuration with defaults
 */
export function normalizeRAGConfig(config: RAGConfig): NormalizedRAGConfig {
  return {
    provider: config.provider || null,
    providers: config.providers || {},
    storage: config.storage || { type: 'json' },
    chunking: {
      strategy: config.chunking?.strategy || 'recursive',
      maxTokens: config.chunking?.maxTokens || 500,
      overlap: config.chunking?.overlap || 50,
    },
    buildTime: config.buildTime
      ? {
          enabled: config.buildTime.enabled,
          outputPath: config.buildTime.outputPath || '.embeddings/embeddings.json',
          chunkSize: config.buildTime.chunkSize || 500,
          chunkOverlap: config.buildTime.chunkOverlap || 50,
          differential: config.buildTime.differential ?? true,
        }
      : null,
    enableMcpTools: config.enableMcpTools ?? true,
    batchSize: config.batchSize || 10,
    rateLimit: config.rateLimit || 100,
  }
}

/**
 * Helper to create OpenAI embedding provider configuration
 *
 * @example
 * ```typescript
 * const provider = openaiEmbeddings({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'text-embedding-3-small'
 * })
 * ```
 */
export function openaiEmbeddings(
  config: Omit<OpenAIEmbeddingConfig, 'type'>,
): OpenAIEmbeddingConfig {
  return {
    type: 'openai',
    ...config,
  }
}

/**
 * Helper to create Ollama embedding provider configuration
 *
 * @example
 * ```typescript
 * const provider = ollamaEmbeddings({
 *   baseURL: 'http://localhost:11434',
 *   model: 'nomic-embed-text'
 * })
 * ```
 */
export function ollamaEmbeddings(
  config?: Omit<OllamaEmbeddingConfig, 'type'>,
): OllamaEmbeddingConfig {
  return {
    type: 'ollama',
    baseURL: config?.baseURL || 'http://localhost:11434',
    model: config?.model || 'nomic-embed-text',
  }
}

/**
 * Helper to create pgvector storage configuration
 *
 * @example
 * ```typescript
 * const storage = pgvectorStorage({ distanceFunction: 'cosine' })
 * ```
 */
export function pgvectorStorage(config?: {
  distanceFunction?: 'cosine' | 'l2' | 'inner_product'
}): VectorStorageConfig {
  return {
    type: 'pgvector',
    distanceFunction: config?.distanceFunction || 'cosine',
  }
}

/**
 * Helper to create SQLite VSS storage configuration
 *
 * @example
 * ```typescript
 * const storage = sqliteVssStorage({ distanceFunction: 'cosine' })
 * ```
 */
export function sqliteVssStorage(config?: {
  distanceFunction?: 'cosine' | 'l2'
}): VectorStorageConfig {
  return {
    type: 'sqlite-vss',
    distanceFunction: config?.distanceFunction || 'cosine',
  }
}

/**
 * Helper to create JSON-based storage configuration
 *
 * @example
 * ```typescript
 * const storage = jsonStorage()
 * ```
 */
export function jsonStorage(): VectorStorageConfig {
  return { type: 'json' }
}

export type { RAGConfig, NormalizedRAGConfig }
export * from './types.js'
