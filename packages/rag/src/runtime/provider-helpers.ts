/**
 * Helper utilities for working with embedding providers
 * Simplifies provider creation from environment variables
 */

import { createEmbeddingProvider } from '../providers/index.js'
import type { EmbeddingProvider } from '../providers/types.js'
import type { EmbeddingProviderConfig } from '../config/types.js'
import 'dotenv/config'

/**
 * Provider type from environment or configuration
 */
export type ProviderType = 'openai' | 'ollama'

/**
 * Create an embedding provider from environment variables
 *
 * Reads configuration from environment variables:
 * - EMBEDDING_PROVIDER: 'openai' or 'ollama' (default: 'openai')
 * - OPENAI_API_KEY: Required if using OpenAI
 * - OLLAMA_BASE_URL: Ollama endpoint (default: 'http://localhost:11434')
 *
 * @param overrides - Optional overrides for environment config
 * @returns Configured embedding provider
 *
 * @example
 * ```typescript
 * import { createProviderFromEnv } from '@opensaas/stack-rag/runtime'
 *
 * // Uses EMBEDDING_PROVIDER and OPENAI_API_KEY from env
 * const provider = createProviderFromEnv()
 *
 * // Override provider type
 * const ollamaProvider = createProviderFromEnv({ provider: 'ollama' })
 * ```
 */
export function createProviderFromEnv(overrides?: {
  provider?: ProviderType
  openaiApiKey?: string
  ollamaBaseUrl?: string
  model?: string
}): EmbeddingProvider {
  const providerType =
    overrides?.provider || (process.env.EMBEDDING_PROVIDER as ProviderType) || 'openai'

  let config: EmbeddingProviderConfig

  if (providerType === 'openai') {
    const apiKey = overrides?.openaiApiKey || process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required when using OpenAI provider')
    }

    config = {
      type: 'openai',
      apiKey,
      model:
        (overrides?.model as 'text-embedding-3-small' | 'text-embedding-3-large') ||
        'text-embedding-3-small',
    }
  } else if (providerType === 'ollama') {
    config = {
      type: 'ollama',
      baseURL: overrides?.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: overrides?.model || 'nomic-embed-text',
    }
  } else {
    throw new Error(`Unknown provider type: ${providerType}. Supported: openai, ollama`)
  }

  return createEmbeddingProvider(config)
}

/**
 * Get provider configuration from environment
 *
 * Useful for inspecting what provider would be used without creating it.
 *
 * @returns Provider configuration object
 *
 * @example
 * ```typescript
 * import { getProviderConfigFromEnv } from '@opensaas/stack-rag/runtime'
 *
 * const config = getProviderConfigFromEnv()
 * console.log(`Using ${config.type} provider`)
 * ```
 */
export function getProviderConfigFromEnv(): EmbeddingProviderConfig {
  const providerType = (process.env.EMBEDDING_PROVIDER as ProviderType) || 'openai'

  if (providerType === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required')
    }

    return {
      type: 'openai',
      apiKey,
      model: 'text-embedding-3-small',
    }
  } else if (providerType === 'ollama') {
    return {
      type: 'ollama',
      baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: 'nomic-embed-text',
    }
  } else {
    throw new Error(`Unknown provider type: ${providerType}`)
  }
}
