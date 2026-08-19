import { z } from 'zod'
import type { BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'
import type { EmbeddingProviderName, ChunkingConfig } from '../config/types.js'

/**
 * Stores vector embeddings as JSON with metadata.
 */
export type EmbeddingField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'embedding'

  /**
   * When this field changes, embeddings are automatically regenerated.
   *
   * @example 'content' or 'title'
   */
  sourceField?: string

  /**
   * References a provider name from RAG config. Falls back to the default
   * provider if not specified.
   *
   * @example 'openai' or 'ollama'
   */
  provider?: EmbeddingProviderName

  /**
   * Must match the provider's output dimensions.
   * @default 1536 (OpenAI text-embedding-3-small)
   */
  dimensions?: number

  /**
   * Only applies if sourceField is set.
   */
  chunking?: ChunkingConfig

  /**
   * @default true if sourceField is set
   */
  autoGenerate?: boolean

  ui?: {
    /**
     * @default false (usually too large to display)
     */
    showVector?: boolean

    /**
     * @default true
     */
    showMetadata?: boolean
  }
}

/**
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

      // Stays optional even when sourceField/autoGenerate is set: ragPlugin
      // populates it via an afterOperation hook, not synchronously on input.
      return embeddingSchema.nullable().optional() as unknown as z.ZodTypeAny
    },

    getPrismaType: (_fieldName: string) => {
      // Json, not a native pgvector column, so the same schema works across
      // the pgvector/sqlite-vss/JSON storage backends.
      return {
        type: 'Json',
        modifiers: '?',
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
