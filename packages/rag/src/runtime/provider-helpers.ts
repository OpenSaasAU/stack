import { createEmbeddingProvider } from '../providers/index.js'
import type { EmbeddingProvider } from '../providers/types.js'
import type { EmbeddingProviderConfig, OllamaEmbeddingConfig } from '../config/types.js'
import 'dotenv/config'

export type ProviderType = 'openai' | 'ollama'

/** `nomic-embed-text`'s output size, the model these helpers default to. */
const DEFAULT_OLLAMA_DIMENSIONS = 768

/**
 * The Ollama model's output size. Ollama reports it only from a live embed
 * call, and it is a schema fact, so it is read from the environment rather
 * than discovered (ADR-0045).
 */
function ollamaDimensionsFromEnv(): number {
  const declared = process.env.OLLAMA_EMBEDDING_DIMENSIONS
  if (declared === undefined || declared.trim() === '') return DEFAULT_OLLAMA_DIMENSIONS

  const parsed = Number(declared)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `OLLAMA_EMBEDDING_DIMENSIONS is "${declared}", which is not a positive integer. It is the ` +
        `Ollama model's output size, so set it to that number or unset it to take ` +
        `${DEFAULT_OLLAMA_DIMENSIONS} (nomic-embed-text).`,
    )
  }
  return parsed
}

export function createProviderFromEnv(overrides?: {
  provider?: ProviderType
  openaiApiKey?: string
  ollamaBaseUrl?: string
  model?: string
  dimensions?: number
}): EmbeddingProvider {
  const providerType =
    overrides?.provider || (process.env.EMBEDDING_PROVIDER as ProviderType) || 'openai'

  if (providerType === 'openai') {
    const apiKey = overrides?.openaiApiKey || process.env.OPENAI_API_KEY

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required when using OpenAI provider')
    }

    return createEmbeddingProvider({
      type: 'openai',
      apiKey,
      model:
        (overrides?.model as 'text-embedding-3-small' | 'text-embedding-3-large') ||
        'text-embedding-3-small',
    })
  }

  if (providerType === 'ollama') {
    return createEmbeddingProvider({
      type: 'ollama',
      baseURL: overrides?.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: overrides?.model || 'nomic-embed-text',
      dimensions: overrides?.dimensions ?? ollamaDimensionsFromEnv(),
    })
  }

  throw new Error(`Unknown provider type: ${String(providerType)}. Supported: openai, ollama`)
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
  }

  if (providerType === 'ollama') {
    // Annotated, not widened to the union: the union's third member is an
    // open `{ type: string }` catch-all, so a missing `dimensions` would
    // otherwise type-check here and surface as `undefined` at run time.
    const ollama: OllamaEmbeddingConfig = {
      type: 'ollama',
      baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: 'nomic-embed-text',
      dimensions: ollamaDimensionsFromEnv(),
    }
    return ollama
  }

  throw new Error(`Unknown provider type: ${String(providerType)}`)
}
