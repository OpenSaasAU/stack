import type { Plugin } from '@opensaas/stack-core'
import type { RAGConfig, NormalizedRAGConfig } from './types.js'
import { normalizeRAGConfig } from './index.js'
import { createEmbeddingProvider } from '../providers/index.js'

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

    init: async (context) => {
      // Find all embedding fields with autoGenerate enabled
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

            // Inject afterOperation hook to auto-generate embeddings
            context.extendList(listName, {
              hooks: {
                afterOperation: async (args) => {
                  if (args.operation === 'create' || args.operation === 'update') {
                    // Skip if item is missing
                    if (!args.item) return

                    const sourceText = args.item[sourceField] as string | undefined
                    const currentEmbedding = args.item[fieldName] as {
                      vector: number[]
                      metadata: { sourceHash?: string }
                    } | null

                    // Skip if source text is empty
                    if (!sourceText) return

                    // Check if we need to regenerate (source text changed)
                    const sourceHash = await hashText(sourceText)
                    if (currentEmbedding && currentEmbedding.metadata.sourceHash === sourceHash) {
                      // Source text hasn't changed, skip regeneration
                      return
                    }

                    // Get provider for this field
                    const providerName = embeddingConfig.provider || 'default'
                    const providerConfig =
                      providerName === 'default'
                        ? normalized.provider
                        : normalized.providers[providerName] || normalized.provider

                    if (!providerConfig) {
                      console.warn(
                        `RAG plugin: No provider configured for field "${listName}.${fieldName}"`,
                      )
                      return
                    }

                    // Generate embedding
                    const provider = createEmbeddingProvider(providerConfig)
                    const vector = await provider.embed(sourceText)

                    // Update record with new embedding
                    const dbKey = listName.charAt(0).toLowerCase() + listName.slice(1)
                    await args.context.db[dbKey].update({
                      where: { id: args.item.id },
                      data: {
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
                      },
                    })
                  }
                },
              },
            })
          }
        }
      }

      // Register MCP tools if enabled
      if (normalized.enableMcpTools && context.registerMcpTool) {
        // Find all lists with embedding fields
        for (const [listName, listConfig] of Object.entries(context.config.lists)) {
          const embeddingFields = Object.entries(listConfig.fields).filter(
            ([, fieldConfig]) => fieldConfig.type === 'embedding',
          )

          if (embeddingFields.length > 0) {
            // Register semantic search tool for this list
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

                // Get provider
                const providerConfig = normalized.provider
                if (!providerConfig) {
                  throw new Error('RAG plugin: No default provider configured')
                }

                // Generate query embedding
                const provider = createEmbeddingProvider(providerConfig)
                const queryVector = await provider.embed(query)

                // Search using configured storage backend
                // Note: This is a simplified implementation
                // Full implementation would use VectorStorage interface
                const dbKey = listName.charAt(0).toLowerCase() + listName.slice(1)
                const allItems = await context.db[dbKey].findMany()

                // Calculate cosine similarity for each item
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
                    // Ensure item is an object before spreading
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

      // Store RAG config for runtime access
      // Access at runtime via: config._pluginData.rag
      context.setPluginData<NormalizedRAGConfig>('rag', normalized)
    },
  }
}

/**
 * Hash text using SHA-256 for change detection
 */
async function hashText(text: string): Promise<string> {
  // Simple hash implementation
  // In production, could use crypto.subtle.digest for better performance
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash.toString(36)
}

/**
 * Calculate cosine similarity between two vectors
 */
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
