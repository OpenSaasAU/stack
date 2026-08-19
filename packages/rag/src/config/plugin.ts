import type { Plugin } from '@opensaas/stack-core/extend'
import type { RAGConfig, NormalizedRAGConfig, SearchableMetadata } from './types.js'
import { normalizeRAGConfig } from './index.js'
import { createEmbeddingProvider } from '../providers/index.js'
import { embedding } from '../fields/embedding.js'

/**
 * RAG plugin for OpenSaas Stack
 * Provides vector embeddings, semantic search, and automatic embedding generation
 *
 * @example
 * ```typescript
 * import { config, list } from '@opensaas/stack-core'
 * import { text } from '@opensaas/stack-core/fields'
 * import { ragPlugin, openaiEmbeddings, pgvectorStorage } from '@opensaas/stack-rag'
 * import { embedding } from '@opensaas/stack-rag/fields'
 *
 * export default config({
 *   plugins: [
 *     ragPlugin({
 *       provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY }),
 *       storage: pgvectorStorage()
 *     })
 *   ],
 *   db: { provider: 'postgresql', url: process.env.DATABASE_URL },
 *   lists: {
 *     Article: list({
 *       fields: {
 *         content: text(),
 *         contentEmbedding: embedding({
 *           sourceField: 'content',
 *           provider: 'openai',
 *           autoGenerate: true
 *         })
 *       }
 *     })
 *   }
 * })
 * ```
 */
export function ragPlugin(config: RAGConfig): Plugin {
  const normalized = normalizeRAGConfig(config)

  return {
    name: 'rag',
    version: '0.1.0',

    runtimeServiceTypes: {
      import: "import type { RAGRuntimeServices } from '@opensaas/stack-rag'",
      typeName: 'RAGRuntimeServices',
    },

    init: async (context) => {
      // Inject embedding fields for searchable() fields first — the pass
      // below, which wires up autoGenerate hooks, must see these before it runs.
      for (const [listName, listConfig] of Object.entries(context.config.lists)) {
        const embeddingFieldsToInject: Record<string, ReturnType<typeof embedding>> = {}

        for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
          if ('_searchable' in fieldConfig) {
            const meta = fieldConfig._searchable as SearchableMetadata
            const embeddingName = meta.embeddingFieldName || `${fieldName}Embedding`

            embeddingFieldsToInject[embeddingName] = embedding({
              sourceField: fieldName,
              provider: meta.provider,
              dimensions: meta.dimensions,
              chunking: meta.chunking,
              autoGenerate: true,
            })
          }
        }

        if (Object.keys(embeddingFieldsToInject).length > 0) {
          context.extendList(listName, {
            fields: embeddingFieldsToInject,
          })
        }
      }

      // Also catches embedding fields injected by the pass above (extendList
      // mutates context.config.lists in place, so this loop sees them too).
      for (const [listName, listConfig] of Object.entries(context.config.lists)) {
        for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
          if (
            fieldConfig.type === 'embedding' &&
            (fieldConfig as { autoGenerate?: boolean }).autoGenerate
          ) {
            const embeddingConfig = fieldConfig as {
              sourceField?: string
              provider?: string
              dimensions?: number
            }

            const sourceField = embeddingConfig.sourceField
            if (!sourceField) {
              throw new Error(
                `RAG plugin: Field "${listName}.${fieldName}" has autoGenerate enabled but no sourceField specified`,
              )
            }

            context.extendList(listName, {
              hooks: {
                resolveInput: async (args) => {
                  if (!args.resolvedData)
                    throw new Error('RAG plugin: Missing resolvedData in resolveInput hook')

                  const sourceText = args.resolvedData[sourceField] as string | undefined
                  const currentEmbedding = args.resolvedData[fieldName] as {
                    vector: number[]
                    metadata: { sourceHash?: string }
                  } | null

                  if (!sourceText) return args.resolvedData

                  const sourceHash = await hashText(sourceText)
                  if (currentEmbedding && currentEmbedding.metadata.sourceHash === sourceHash) {
                    return args.resolvedData
                  }

                  const providerName = embeddingConfig.provider || 'default'
                  const providerConfig =
                    providerName === 'default'
                      ? normalized.provider
                      : normalized.providers[providerName] || normalized.provider

                  if (!providerConfig) {
                    console.warn(
                      `RAG plugin: No provider configured for field "${listName}.${fieldName}"`,
                    )
                    return args.resolvedData
                  }

                  const provider = createEmbeddingProvider(providerConfig)
                  const vector = await provider.embed(sourceText)

                  return {
                    ...args.resolvedData,
                    [fieldName]: {
                      vector,
                      metadata: {
                        model: provider.model,
                        provider: provider.type,
                        dimensions: provider.dimensions,
                        generatedAt: new Date().toISOString(),
                        sourceHash,
                      },
                    },
                  }
                },
              },
            })
          }
        }
      }

      if (normalized.enableMcpTools && context.registerMcpTool) {
        for (const [listName, listConfig] of Object.entries(context.config.lists)) {
          const embeddingFields = Object.entries(listConfig.fields).filter(
            ([, fieldConfig]) => fieldConfig.type === 'embedding',
          )

          if (embeddingFields.length > 0) {
            const toolName = `semantic_search_${listName.toLowerCase()}`

            context.registerMcpTool({
              name: toolName,
              description: `Search ${listName} using natural language (semantic search)`,
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Natural language search query' },
                  limit: { type: 'number', description: 'Maximum results', default: 10 },
                  minScore: {
                    type: 'number',
                    description: 'Minimum similarity score (0-1)',
                    default: 0.5,
                  },
                  field: {
                    type: 'string',
                    description: 'Embedding field to search',
                    default: embeddingFields[0][0],
                    enum: embeddingFields.map(([name]) => name),
                  },
                },
                required: ['query'],
              },
              handler: async ({ input, context }) => {
                const { query, limit = 10, minScore = 0.5, field = embeddingFields[0][0] } = input

                const providerConfig = normalized.provider
                if (!providerConfig) {
                  throw new Error('RAG plugin: No default provider configured')
                }

                const provider = createEmbeddingProvider(providerConfig)
                const queryVector = await provider.embed(query)

                // Simplified: computes similarity in JS over every item rather
                // than delegating to the configured VectorStorage backend.
                const dbKey = listName.charAt(0).toLowerCase() + listName.slice(1)
                const allItems = await context.db[dbKey].findMany()

                const results = allItems
                  .map((item: { [key: string]: { vector: number[] } | null }) => {
                    const embedding = item[field]
                    if (!embedding || !embedding.vector) return null

                    const score = cosineSimilarity(queryVector, embedding.vector)
                    return { item, score }
                  })
                  .filter((r: { score: number } | null) => r !== null && r.score >= minScore)
                  .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
                  .slice(0, limit)

                return {
                  results: results.map((r: { item: unknown; score: number }) => {
                    const item = r.item as Record<string, unknown>
                    return {
                      ...item,
                      _similarity: r.score,
                    }
                  }),
                  count: results.length,
                }
              },
            })
          }
        }
      }

      // Access at runtime via: config._pluginData.rag
      context.setPluginData<NormalizedRAGConfig>('rag', normalized)
    },

    runtime: () => {
      return {
        /** Uses the top-level configured provider (not the per-field `providers` map the auto-generate hook honors). */
        generateEmbedding: async (text: string) => {
          const ragConfig = normalized
          if (!ragConfig || !ragConfig.provider) {
            throw new Error('RAG plugin not configured')
          }

          const provider = createEmbeddingProvider(ragConfig.provider)
          return await provider.embed(text)
        },

        /** Batch counterpart of {@link generateEmbedding}; same provider selection. */
        generateEmbeddings: async (texts: string[]) => {
          const ragConfig = normalized
          if (!ragConfig || !ragConfig.provider) {
            throw new Error('RAG plugin not configured')
          }

          const provider = createEmbeddingProvider(ragConfig.provider)
          return await provider.embedBatch(texts)
        },
      }
    },
  }
}

/**
 * Non-cryptographic hash of `text`, used to detect whether source text
 * changed since the last embedding was generated.
 */
async function hashText(text: string): Promise<string> {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash.toString(36)
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimensions')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}
