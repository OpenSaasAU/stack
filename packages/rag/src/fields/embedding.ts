import { z } from 'zod'
import type { BaseFieldConfig, TypeInfo } from '@opensaas/stack-core'
import type { StoredEmbedding, EmbeddingProviderName, ChunkingConfig } from '../config/types.js'

/**
 * Embedding field configuration
 * Stores vector embeddings as JSON with metadata
 */
export type EmbeddingField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<
  StoredEmbedding | null,
  StoredEmbedding | null,
  TTypeInfo
> & {
  type: 'embedding'

  /**
   * Source field name to generate embeddings from
   * When this field changes, embeddings will be automatically regenerated
   *
   * @example 'content' or 'title'
   */
  sourceField?: string

  /**
   * Embedding provider to use
   * References a provider name from RAG config
   * Falls back to default provider if not specified
   *
   * @example 'openai' or 'ollama'
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
   * Only applies if sourceField is set
   */
  chunking?: ChunkingConfig

  /**
   * Whether to automatically generate embeddings
   * @default true if sourceField is set
   */
  autoGenerate?: boolean

  /**
   * UI configuration
   */
  ui?: {
    /**
     * Whether to show the embedding vector in the UI
     * @default false (usually too large to display)
     */
    showVector?: boolean

    /**
     * Whether to show embedding metadata
     * @default true
     */
    showMetadata?: boolean
  }
}

/**
 * Embedding field builder
 * Creates a field that stores vector embeddings with metadata
 *
 * @example
 * ```typescript
 * import { embedding } from '@opensaas/stack-rag/fields'
 *
 * // Manual embedding storage
 * fields: {
 *   embedding: embedding({
 *     dimensions: 1536,
 *     provider: 'openai'
 *   })
 * }
 *
 * // Automatic embedding generation from source field
 * fields: {
 *   content: text(),
 *   contentEmbedding: embedding({
 *     sourceField: 'content',
 *     provider: 'openai',
 *     dimensions: 1536,
 *     autoGenerate: true
 *   })
 * }
 * ```
 */
export function embedding<TTypeInfo extends TypeInfo = TypeInfo>(
  options?: Omit<EmbeddingField<TTypeInfo>, 'type'>,
): EmbeddingField<TTypeInfo> {
  const dimensions = options?.dimensions || 1536
  const autoGenerate = options?.autoGenerate ?? options?.sourceField != null

  return {
    type: 'embedding',
    ...options,
    dimensions,
    autoGenerate,

    getZodSchema: (_fieldName: string, _operation: 'create' | 'update') => {
      // Embedding schema validation
      const embeddingSchema = z.object({
        vector: z.array(z.number()).length(dimensions, {
          message: `Embedding vector must have exactly ${dimensions} dimensions`,
        }),
        metadata: z.object({
          model: z.string(),
          provider: z.string(),
          dimensions: z.number(),
          generatedAt: z.string(),
          sourceHash: z.string().optional(),
        }),
      })

      // Embeddings are always optional in input
      // They are generated automatically via hooks if sourceField is set
      return embeddingSchema.nullable().optional() as unknown as z.ZodTypeAny
    },

    getPrismaType: (_fieldName: string) => {
      // Store as JSON in database
      // For pgvector, we could use vector() type, but JSON is more portable
      return {
        type: 'Json',
        modifiers: '?', // Always optional
      }
    },

    getTypeScriptType: () => {
      return {
        type: 'StoredEmbedding | null',
        optional: true,
      }
    },

    getTypeScriptImports: () => {
      return [
        {
          names: ['StoredEmbedding'],
          from: '@opensaas/stack-rag',
          typeOnly: true,
        },
      ]
    },
  }
}
