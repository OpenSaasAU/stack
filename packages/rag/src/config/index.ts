import type { OpenSaasConfig } from '@opensaas/stack-core'
import type {
  RAGConfig,
  NormalizedRAGConfig,
  EmbeddingProviderConfig,
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
    enableMcpTools: config.enableMcpTools ?? true,
    batchSize: config.batchSize || 10,
    rateLimit: config.rateLimit || 100,
  }
}

/**
 * RAG configuration builder
 * Use this to create a RAG configuration object
 *
 * @example
 * ```typescript
 * import { ragConfig, openaiEmbeddings } from '@opensaas/stack-rag'
 *
 * const rag = ragConfig({
 *   provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY }),
 *   storage: { type: 'pgvector' }
 * })
 * ```
 */
export function ragConfig(config: RAGConfig): RAGConfig {
  return config
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
export function pgvectorStorage(
  config?: { distanceFunction?: 'cosine' | 'l2' | 'inner_product' },
): VectorStorageConfig {
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
export function sqliteVssStorage(
  config?: { distanceFunction?: 'cosine' | 'l2' },
): VectorStorageConfig {
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

/**
 * Wrap an OpenSaas config with RAG integration
 * This adds RAG metadata to the config for use by runtime and MCP tools
 *
 * @example
 * ```typescript
 * import { config } from '@opensaas/stack-core'
 * import { withRAG, ragConfig, openaiEmbeddings } from '@opensaas/stack-rag'
 *
 * export default withRAG(
 *   config({
 *     db: { provider: 'sqlite', url: 'file:./dev.db' },
 *     lists: {
 *       Article: list({
 *         fields: {
 *           content: searchable(text(), {
 *             provider: 'openai'
 *           })
 *         }
 *       })
 *     }
 *   }),
 *   ragConfig({
 *     provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY }),
 *     storage: { type: 'pgvector' }
 *   })
 * )
 * ```
 */
export function withRAG(opensaasConfig: OpenSaasConfig, ragConfig: RAGConfig): OpenSaasConfig {
  const normalized = normalizeRAGConfig(ragConfig)

  // Return merged config with RAG config attached
  const result: OpenSaasConfig & { __ragConfig?: NormalizedRAGConfig } = {
    ...opensaasConfig,
  }

  // Store RAG config for internal use (runtime and MCP tools)
  result.__ragConfig = normalized

  return result
}

/**
 * Get RAG config from an OpenSaas config
 * Returns null if RAG is not configured
 */
export function getRAGConfig(config: OpenSaasConfig): NormalizedRAGConfig | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (config as any).__ragConfig || null
}

/**
 * Get embedding provider by name from RAG config
 * Falls back to default provider if name not found
 */
export function getEmbeddingProvider(
  ragConfig: NormalizedRAGConfig,
  providerName?: string,
): EmbeddingProviderConfig | null {
  if (providerName && ragConfig.providers[providerName]) {
    return ragConfig.providers[providerName]
  }
  return ragConfig.provider
}

export type { RAGConfig, NormalizedRAGConfig }
export * from './types.js'
