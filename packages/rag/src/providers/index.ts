import type { EmbeddingProvider } from './types.js'
import type {
  EmbeddingProviderConfig,
  OllamaEmbeddingConfig,
  OpenAIEmbeddingConfig,
} from '../config/types.js'
import { createOpenAIProvider } from './openai.js'
import { createOllamaProvider } from './ollama.js'

const providerFactories = new Map<string, (config: EmbeddingProviderConfig) => EmbeddingProvider>()

providerFactories.set('openai', (config) => {
  if (config.type !== 'openai') {
    throw new Error('Invalid config type for OpenAI provider')
  }
  return createOpenAIProvider(config as import('../config/types.js').OpenAIEmbeddingConfig)
})
providerFactories.set('ollama', (config) => {
  if (config.type !== 'ollama') {
    throw new Error('Invalid config type for Ollama provider')
  }
  return createOllamaProvider(config as import('../config/types.js').OllamaEmbeddingConfig)
})

/**
 * @example
 * ```typescript
 * import { registerEmbeddingProvider } from '@opensaas/stack-rag/providers'
 *
 * registerEmbeddingProvider('custom', (config) => {
 *   return new CustomEmbeddingProvider(config)
 * })
 * ```
 */
export function registerEmbeddingProvider(
  type: string,
  factory: (config: EmbeddingProviderConfig) => EmbeddingProvider,
): void {
  providerFactories.set(type, factory)
}

/**
 * The config a literal naming a built-in provider must satisfy, whatever else
 * it declares.
 *
 * `EmbeddingProviderConfig`'s third member is `CustomEmbeddingConfig`, an open
 * `{ type: string }`, so `{ type: 'ollama', model }` is assignable to the union
 * through it even though `OllamaEmbeddingConfig.dimensions` is required.
 * TypeScript has no way to subtract `'ollama'` from `string`, so the union
 * itself cannot close that; intersecting the argument here does, for every
 * literal that reaches this funnel.
 */
type BuiltInConfigFor<TConfig> = TConfig extends { type: 'openai' }
  ? OpenAIEmbeddingConfig
  : TConfig extends { type: 'ollama' }
    ? OllamaEmbeddingConfig
    : EmbeddingProviderConfig

/**
 * @example
 * ```typescript
 * import { createEmbeddingProvider } from '@opensaas/stack-rag/providers'
 *
 * const provider = createEmbeddingProvider({
 *   type: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'text-embedding-3-small'
 * })
 *
 * const embedding = await provider.embed('Hello world')
 * ```
 */
export function createEmbeddingProvider<TConfig extends EmbeddingProviderConfig>(
  config: TConfig & BuiltInConfigFor<TConfig>,
): EmbeddingProvider {
  const factory = providerFactories.get(config.type)

  if (!factory) {
    throw new Error(
      `Unknown embedding provider type: ${config.type}. ` +
        `Available providers: ${Array.from(providerFactories.keys()).join(', ')}`,
    )
  }

  return factory(config)
}

export * from './types.js'
export { OpenAIEmbeddingProvider, createOpenAIProvider, OPENAI_MODEL_DIMENSIONS } from './openai.js'
export { OllamaEmbeddingProvider, createOllamaProvider } from './ollama.js'
