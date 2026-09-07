import type {
  RAGConfig,
  NormalizedRAGConfig,
  OpenAIEmbeddingConfig,
  OllamaEmbeddingConfig,
} from './types.js'

export function normalizeRAGConfig(config: RAGConfig): NormalizedRAGConfig {
  return {
    provider: config.provider || null,
    providers: config.providers || {},
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
 *   model: 'nomic-embed-text',
 *   dimensions: 768,
 * })
 * ```
 */
export function ollamaEmbeddings(
  config: Omit<OllamaEmbeddingConfig, 'type'>,
): OllamaEmbeddingConfig {
  return {
    type: 'ollama',
    baseURL: config.baseURL || 'http://localhost:11434',
    model: config.model || 'nomic-embed-text',
    dimensions: config.dimensions,
  }
}

export type { RAGConfig, NormalizedRAGConfig }
export * from './types.js'
