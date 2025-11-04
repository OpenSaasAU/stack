import type { EmbeddingProvider } from './types.js'
import type { EmbeddingProviderConfig } from '../config/types.js'
import { createOpenAIProvider } from './openai.js'
import { createOllamaProvider } from './ollama.js'

/**
 * Provider factory registry
 * Maps provider types to factory functions
 */
const providerFactories = new Map<string, (config: EmbeddingProviderConfig) => EmbeddingProvider>()

/**
 * Register the built-in providers
 */
providerFactories.set('openai', (config) => createOpenAIProvider(config as any))
providerFactories.set('ollama', (config) => createOllamaProvider(config as any))

/**
 * Register a custom embedding provider factory
 * Use this to add support for custom embedding providers
 *
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
 * Create an embedding provider instance from configuration
 * Automatically selects the correct provider based on config.type
 *
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
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  const factory = providerFactories.get(config.type)

  if (!factory) {
    throw new Error(
      `Unknown embedding provider type: ${config.type}. ` +
      `Available providers: ${Array.from(providerFactories.keys()).join(', ')}`
    )
  }

  return factory(config)
}

// Export types and individual providers
export * from './types.js'
export { OpenAIEmbeddingProvider, createOpenAIProvider } from './openai.js'
export { OllamaEmbeddingProvider, createOllamaProvider } from './ollama.js'
