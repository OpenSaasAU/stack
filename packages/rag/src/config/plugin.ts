import type { Plugin } from '@opensaas/stack-core/extend'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import type {
  EmbeddingProviderConfig,
  RAGConfig,
  NormalizedRAGConfig,
  SearchableMetadata,
  StoredEmbedding,
} from './types.js'
import { normalizeRAGConfig } from './index.js'
import { createEmbeddingProvider } from '../providers/index.js'
import { OPENAI_MODEL_DIMENSIONS } from '../providers/openai.js'
import { embedding } from '../fields/embedding.js'
import type { EmbeddingField } from '../fields/embedding.js'
import type { RAGRuntimeServices } from '../runtime/types.js'

/** The pgvector extension pack, which the app author never has to name (ADR-0049). */
const PGVECTOR_EXTENSION = {
  name: 'pgvector',
  from: '@prisma/orm-extension-pgvector',
} as const

function isEmbeddingField(field: { type?: string }): field is EmbeddingField {
  return field.type === 'embedding'
}

/**
 * The seat of the plugin's escalated write. Keyed by a module-private symbol
 * and absent from {@link RAGRuntimeServices}, so it is on neither the package's
 * exported surface nor the generated `PluginServices` face — `sudo()` bypasses
 * a list's operation access and its Access Filter as well as this field's own
 * denial, and only the generation hook below may hold that (ADR-0045).
 * Application code that maintains its own vectors uses
 * `embedding({ allowManualWrites: true })` and an ordinary `context.db` write.
 */
const WRITE_EMBEDDING = Symbol('rag.writeEmbedding')

type EmbeddingWriter = (
  listKey: string,
  id: string | number,
  fieldName: string,
  stored: StoredEmbedding,
) => Promise<void>

type RAGInternalServices = RAGRuntimeServices & { [WRITE_EMBEDDING]: EmbeddingWriter }

function rowId(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

/**
 * A provider's output dimension where it is known without calling anything.
 * OpenAI's models each have a fixed size; Ollama declares its own; a custom
 * provider that declares none is exempt from the generate-time check.
 */
function knownDimensions(provider: EmbeddingProviderConfig): number | undefined {
  if (provider.type === 'openai') {
    const model: unknown = Reflect.get(provider, 'model') ?? 'text-embedding-3-small'
    return typeof model === 'string' ? OPENAI_MODEL_DIMENSIONS.get(model) : undefined
  }
  const declared: unknown = Reflect.get(provider, 'dimensions')
  return typeof declared === 'number' ? declared : undefined
}

function providerLabel(name: string, provider: EmbeddingProviderConfig): string {
  const model: unknown = Reflect.get(provider, 'model')
  return typeof model === 'string' ? `${name} provider "${model}"` : `${name} provider`
}

/**
 * RAG plugin for OpenSaas Stack
 * Provides vector embeddings, semantic search, and automatic embedding generation
 *
 * @example
 * ```typescript
 * import { config, list } from '@opensaas/stack-core'
 * import { text } from '@opensaas/stack-core/fields'
 * import { ragPlugin, openaiEmbeddings } from '@opensaas/stack-rag'
 * import { embedding } from '@opensaas/stack-rag/fields'
 *
 * export default config({
 *   plugins: [ragPlugin({ provider: openaiEmbeddings({ apiKey: process.env.OPENAI_API_KEY }) })],
 *   db: { provider: 'postgresql' },
 *   lists: {
 *     Article: list({
 *       fields: {
 *         content: text(),
 *         contentEmbedding: embedding({ sourceField: 'content', provider: 'openai' }),
 *       },
 *     })
 *   }
 * })
 * ```
 */
export function ragPlugin(config: RAGConfig): Plugin {
  const normalized = normalizeRAGConfig(config)

  const providerFor = (name: string | undefined): EmbeddingProviderConfig | null => {
    if (name === undefined || name === 'default') return normalized.provider
    return normalized.providers[name] ?? normalized.provider
  }

  return {
    name: 'rag',
    version: '0.1.0',

    runtimeServiceTypes: {
      import: "import type { RAGRuntimeServices } from '@opensaas/stack-rag'",
      typeName: 'RAGRuntimeServices',
    },

    init: async (context) => {
      context.addExtension(PGVECTOR_EXTENSION)

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
          if (!isEmbeddingField(fieldConfig) || !fieldConfig.autoGenerate) continue

          const sourceField = fieldConfig.sourceField
          if (!sourceField) {
            throw new Error(
              `RAG plugin: Field "${listName}.${fieldName}" has autoGenerate enabled but no sourceField specified`,
            )
          }
          const providerName = fieldConfig.provider

          context.extendList(listName, {
            hooks: {
              // The embedding is write-denied to application code, so the
              // plugin writes it under sudo — and after the write's own
              // transaction settles, because the provider call is a network
              // round trip that has no business holding a connection
              // (ADR-0045).
              afterTransaction: async (args) => {
                if (args.status !== 'committed') return
                if (args.operation !== 'create' && args.operation !== 'update') return
                // The sudo write below names the embedding, not the source, so
                // this is what stops it re-entering.
                if (!(sourceField in args.inputData)) return

                const item = args.item
                if (item === undefined) return
                const id = rowId(item.id)
                if (id === undefined) return
                const sourceText = item[sourceField]
                if (typeof sourceText !== 'string' || sourceText.length === 0) return

                const providerConfig = providerFor(providerName)
                if (!providerConfig) {
                  console.warn(
                    `RAG plugin: No provider configured for field "${listName}.${fieldName}"`,
                  )
                  return
                }

                const sourceHash = hashText(sourceText)
                const current = item[fieldName]
                if (storedSourceHash(current) === sourceHash) return

                const provider = createEmbeddingProvider(providerConfig)
                const vector = await provider.embed(sourceText)

                const stored: StoredEmbedding = {
                  vector,
                  metadata: {
                    model: provider.model,
                    provider: provider.type,
                    dimensions: provider.dimensions,
                    generatedAt: new Date().toISOString(),
                    sourceHash,
                  },
                }

                await embeddingWriter(args.context)(listName, id, fieldName, stored)
              },
            },
          })
        }
      }

      if (normalized.enableMcpTools && context.registerMcpTool) {
        for (const [listName, listConfig] of Object.entries(context.config.lists)) {
          const embeddingFields = Object.entries(listConfig.fields).filter(([, fieldConfig]) =>
            isEmbeddingField(fieldConfig),
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

                const matches = await context.db[listName].nearest(field, queryVector, {
                  limit,
                  minScore,
                })

                return {
                  results: matches.map((match) => ({ ...match.item, _similarity: match.score })),
                  count: matches.length,
                }
              },
            })
          }
        }
      }

      // Access at runtime via: config._pluginData.rag
      context.setPluginData<NormalizedRAGConfig>('rag', normalized)
    },

    /**
     * Refuse a schema fact that is already known to be wrong: a declared
     * dimension that disagrees with its provider's, and an Ollama provider
     * with no dimension at all. Both are checked here rather than in the
     * generator, which knows nothing about embedding providers (ADR-0045).
     */
    beforeGenerate: (generateConfig: OpenSaasConfig) => {
      for (const [name, provider] of Object.entries({
        ...normalized.providers,
        ...(normalized.provider ? { default: normalized.provider } : {}),
      })) {
        if (provider.type !== 'ollama') continue
        const declared: unknown = Reflect.get(provider, 'dimensions')
        if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1) {
          throw new Error(
            `RAG plugin: the ${providerLabel(name, provider)} declares no dimensions. Ollama ` +
              `reports its output size only from a live embed call, and generation must not ` +
              `depend on a running Ollama, so ollamaEmbeddings({ dimensions }) is required.`,
          )
        }
      }

      for (const [listName, listConfig] of Object.entries(generateConfig.lists)) {
        for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
          if (!isEmbeddingField(fieldConfig)) continue
          const providerName = fieldConfig.provider
          const providerConfig = providerFor(providerName)
          if (!providerConfig) continue

          const providerDimensions = knownDimensions(providerConfig)
          if (providerDimensions === undefined) continue
          if (fieldConfig.dimensions === providerDimensions) continue

          throw new Error(
            `RAG plugin: "${listName}.${fieldName}" declares ${fieldConfig.dimensions} ` +
              `dimensions, but its ${providerLabel(providerName ?? 'default', providerConfig)} ` +
              `produces ${providerDimensions}. The dimension is a column's type, so the two have ` +
              `to agree before a migration is planned.`,
          )
        }
      }

      return generateConfig
    },

    runtime: (_context, sudo): RAGInternalServices => {
      const requireProvider = (providerName?: string) => {
        const providerConfig = providerFor(providerName)
        if (!providerConfig) {
          throw new Error('RAG plugin not configured')
        }
        return createEmbeddingProvider(providerConfig)
      }

      return {
        generateEmbedding: async (text: string, providerName?: string) =>
          await requireProvider(providerName).embed(text),

        generateEmbeddings: async (texts: string[], providerName?: string) =>
          await requireProvider(providerName).embedBatch(texts),

        [WRITE_EMBEDDING]: async (listKey, id, fieldName, stored) => {
          await sudoWrite(sudo(), listKey, id, fieldName, stored)
        },
      }
    },
  }
}

/**
 * Write a generated embedding past its own write denial. A denied field-level
 * write throws, and `checkFieldAccess` returns true under sudo, so a sudo
 * context is how the plugin's own output reaches the column (ADR-0045). A
 * hook's `AccessContext` cannot derive one, which is why the write is created
 * by `Plugin.runtime`, closing over the `sudo` factory it is handed, and
 * reached only through {@link WRITE_EMBEDDING}.
 */
async function sudoWrite(
  context: AccessContext,
  listKey: string,
  id: string | number,
  fieldName: string,
  stored: StoredEmbedding,
): Promise<void> {
  const list = context.db[listKey]
  if (list === undefined) {
    throw new Error(`RAG plugin: list "${listKey}" is not on this context's db surface`)
  }
  await list.update({
    where: { id },
    data: { [fieldName]: stored },
  })
}

function hasEmbeddingWriter(value: unknown): value is { [WRITE_EMBEDDING]: EmbeddingWriter } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, WRITE_EMBEDDING) === 'function'
  )
}

function embeddingWriter(context: AccessContext): EmbeddingWriter {
  const services: unknown = context.plugins.rag
  if (!hasEmbeddingWriter(services)) {
    throw new Error(
      'RAG plugin: context.plugins.rag is missing, so a generated embedding has no sudo write to ' +
        'reach its write-denied column through. The context was built without the plugin.',
    )
  }
  return services[WRITE_EMBEDDING]
}

/** The `sourceHash` of an already-stored embedding, when there is one. */
function storedSourceHash(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const metadata: unknown = Reflect.get(value, 'metadata')
  if (metadata === null || typeof metadata !== 'object') return undefined
  const hash: unknown = Reflect.get(metadata, 'sourceHash')
  return typeof hash === 'string' ? hash : undefined
}

/**
 * Non-cryptographic hash of `text`, used to detect whether source text
 * changed since the last embedding was generated.
 */
function hashText(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return hash.toString(36)
}
