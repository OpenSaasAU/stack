import { createEmbeddingProvider } from '../providers/index.js'
import type { EmbeddingProvider } from '../providers/types.js'
import type { EmbeddingProviderConfig } from '../config/types.js'
import 'dotenv/config'

export type ProviderType = 'openai' | 'ollama'

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
