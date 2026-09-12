import type { Plugin } from '@opensaas/stack-core/extend'
import { writePluginOwnedField } from '@opensaas/stack-core/extend'
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
import { createGenerationFailureReporter } from './generation-failure.js'

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
 * exported surface nor the generated `PluginServices` face — the write reaches
 * the embedding's columns past this field's own denial and past the list's
 * operation access, and only the generation hook below may hold that
 * (ADR-0045). It runs no hook: a write carrying this column alone would lie to
 * every hook it ran (ADR-0068). Application code that maintains its own
 * vectors uses `embedding({ allowManualWrites: true })` and an ordinary
 * `context.db` write, which runs the whole pipeline as usual.
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
 * MCP tool arguments arrive as whatever the assistant sent — `McpCustomTool`
 * types `input` loosely, and `handleCustomTool` validates an `inputSchema`
 * only when it is a Zod schema, so this tool's plain JSON Schema is never
 * enforced and its arguments reach the handler raw.
 *
 * A wrongly-typed argument is refused by name rather than replaced by the
 * default: silently answering a different question than the one asked is
 * worse for an assistant caller than an error it can correct.
 */
function toolArg(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? Reflect.get(input, key) : undefined
}

function stringArg(input: unknown, key: string, toolName: string): string | undefined {
  const value = toolArg(input, key)
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${toolName}: "${key}" must be a string`)
  }
  return value
}

function numberArg(input: unknown, key: string, toolName: string): number | undefined {
  const value = toolArg(input, key)
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${toolName}: "${key}" must be a finite number`)
  }
  return value
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
  const reportGenerationFailure = createGenerationFailureReporter()

  /**
   * Whether `name` is a provider this plugin was given. `Object.hasOwn` rather
   * than `in`: `providers` is an ordinary object, so `in` answers for
   * `toString` and `constructor` too.
   */
  const providerIsDeclared = (name: string | undefined): boolean =>
    name === undefined ||
    name === 'default' ||
    Object.hasOwn(normalized.providers, name) ||
    name === normalized.provider?.type

  /**
   * The provider a name resolves to, or null when the plugin does not declare
   * it. A name that is not declared never falls back to the default: the
   * provider fixes a column's dimension, so the fallback silently produced a
   * column of the wrong width. `beforeGenerate` refuses the same names, so the
   * generate-time and runtime answers agree.
   */
  const providerFor = (name: string | undefined): EmbeddingProviderConfig | null => {
    if (!providerIsDeclared(name)) return null
    if (name === undefined || name === 'default') return normalized.provider
    return normalized.providers[name] ?? normalized.provider
  }

  const declaredProviderNames = (): string[] => [
    ...(normalized.provider ? ['default', normalized.provider.type] : []),
    ...Object.keys(normalized.providers),
  ]

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

      // A field that declares no dimension takes its provider's, so an app on a
      // 768-dimension model writes `searchable(text())` without repeating the
      // number at every call site. Only a provider that declares none of its
      // own reaches `embedding()`'s default.
      for (const [listName, listConfig] of Object.entries(context.config.lists)) {
        for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
          if (!isEmbeddingField(fieldConfig) || fieldConfig.dimensions !== undefined) continue

          const providerConfig = providerFor(fieldConfig.provider)
          const dimensions = providerConfig ? knownDimensions(providerConfig) : undefined
          if (dimensions === undefined) continue

          context.extendList(listName, {
            fields: { [fieldName]: embedding({ ...fieldConfig, dimensions }) },
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
              // plugin writes its own columns past that denial and runs no
              // hook doing it (ADR-0045, ADR-0068) — and after the write's own
              // transaction settles, because the provider call is a network
              // round trip that has no business holding a connection.
              //
              // Known limits: the row is already committed by the time this
              // runs, so none of the three gaps below can abort it.
              //  - #1271: a nested record is never embedded — `afterTransaction`
              //    carries a persisted `item` for the top-level record only.
              //  - #1271: a provider failure is logged, not thrown. The write
              //    the caller made did succeed, and reporting it as a failure
              //    would invite a retry that duplicates the row. The row keeps
              //    a null embedding and there is no regeneration path yet.
              afterTransaction: async (args) => {
                if (args.status !== 'committed') return
                if (args.operation !== 'create' && args.operation !== 'update') return

                const item = args.item
                if (item === undefined) {
                  console.warn(
                    `RAG plugin: "${listName}.${fieldName}" was not embedded — a nested ` +
                      `${listName} has no persisted row outside its transaction, so the record ` +
                      `keeps a null embedding (#1271).`,
                  )
                  return
                }
                const id = rowId(item.id)
                if (id === undefined) return
                // The persisted text, not the caller's input: a source field a
                // resolveInput hook derived is embedded like any other. The
                // stored source hash below is what stops an update that leaves
                // the source alone from paying for a second provider call.
                const sourceText = item[sourceField]
                if (typeof sourceText !== 'string' || sourceText.length === 0) return

                const providerConfig = providerFor(providerName)
                if (!providerConfig) {
                  console.warn(
                    `RAG plugin: "${listName}.${fieldName}" names the provider ` +
                      `"${String(providerName ?? 'default')}", which ragPlugin does not declare, ` +
                      `so the record keeps a null embedding. Declared providers: ` +
                      `${declaredProviderNames().join(', ') || 'none'}.`,
                  )
                  return
                }

                const sourceHash = hashText(sourceText)
                const current = item[fieldName]
                if (storedSourceHash(current) === sourceHash) return

                const write = embeddingWriter(args.context)

                try {
                  const provider = createEmbeddingProvider(providerConfig)
                  const vector = await provider.embed(sourceText)

                  await write(listName, id, fieldName, {
                    vector,
                    metadata: {
                      model: provider.model,
                      provider: provider.type,
                      dimensions: provider.dimensions,
                      generatedAt: new Date().toISOString(),
                      sourceHash,
                    },
                  })
                } catch (error) {
                  reportGenerationFailure({
                    listName,
                    fieldName,
                    id,
                    provider: providerLabel(providerName ?? 'default', providerConfig),
                    error,
                  })
                }
              },
            },
          })
        }
      }

      if (normalized.enableMcpTools && context.registerMcpTool) {
        for (const [listName, listConfig] of Object.entries(context.config.lists)) {
          const embeddingFields = Object.entries(listConfig.fields).filter(
            (entry): entry is [string, EmbeddingField] => isEmbeddingField(entry[1]),
          )

          if (embeddingFields.length > 0) {
            const toolName = `semantic_search_${listName.toLowerCase()}`
            const defaultField = embeddingFields[0][0]
            const providerNames = new Map(
              embeddingFields.map(([name, fieldConfig]) => [name, fieldConfig.provider]),
            )

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
                    description:
                      "Minimum similarity score, on the searched field's own distance function " +
                      'rather than a normalised 0-1 scale: "cosine" scores the raw cosine on ' +
                      '[-1, 1], "l2" scores 1 / (1 + distance) on (0, 1], and "inner_product" ' +
                      'scores the dot product, which is unbounded. Omitted, the search is ' +
                      'ranked with no bound at all — the only default that means the same ' +
                      'thing on all three scales.',
                  },
                  field: {
                    type: 'string',
                    description: 'Embedding field to search',
                    default: defaultField,
                    enum: embeddingFields.map(([name]) => name),
                  },
                },
                required: ['query'],
              },
              handler: async ({ input, context }) => {
                const query = stringArg(input, 'query', toolName)
                if (query === undefined) {
                  throw new Error(`${toolName}: "query" is required and must be a string`)
                }
                const limit = numberArg(input, 'limit', toolName) ?? 10
                const minScore = numberArg(input, 'minScore', toolName)
                const field = stringArg(input, 'field', toolName) ?? defaultField

                // The field's own provider, not the plugin's default: a
                // provider fixes the width of the vector it produces, and
                // `nearest()` validates the query vector against the column's
                // declared dimension.
                if (!providerNames.has(field)) {
                  throw new Error(
                    `${toolName}: "${field}" is not an embedding field of ${listName}. Searchable ` +
                      `fields: ${embeddingFields.map(([name]) => name).join(', ')}.`,
                  )
                }
                const providerName = providerNames.get(field)
                const providerConfig = providerFor(providerName)
                if (!providerConfig) {
                  throw new Error(
                    `${toolName}: "${listName}.${field}" names the provider ` +
                      `"${String(providerName ?? 'default')}", which ragPlugin does not declare. ` +
                      `Declared providers: ${declaredProviderNames().join(', ') || 'none'}.`,
                  )
                }

                const provider = createEmbeddingProvider(providerConfig)
                const queryVector = await provider.embed(query)

                const matches = await context.db[listName].nearest(field, queryVector, {
                  limit,
                  ...(minScore === undefined ? {} : { minScore }),
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
     * Refuse a schema fact that is already known to be wrong: a datasource no
     * embedding column can be lowered onto, a field naming a provider the
     * plugin does not declare, a declared dimension that disagrees with its
     * provider's, and an Ollama provider with no dimension at all. All four
     * are checked here rather than in the generator, which knows nothing about
     * embedding providers (ADR-0045).
     */
    beforeGenerate: (generateConfig: OpenSaasConfig) => {
      const dbProvider: string = generateConfig.db.provider
      if (dbProvider !== 'postgresql') {
        throw new Error(
          `RAG plugin: the datasource is "${dbProvider}", and every column this plugin emits is ` +
            `Postgres-only — an embedding is a pgvector vector column with its metadata in a ` +
            `jsonb column beside it, and the plugin declares the pgvector extension pack for ` +
            `every config. Move the datasource to postgresql with pgvector available, or remove ` +
            `ragPlugin.`,
        )
      }

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
          if (!providerIsDeclared(providerName)) {
            const declaredNames = declaredProviderNames()
            throw new Error(
              `RAG plugin: "${listName}.${fieldName}" names the provider ` +
                `"${String(providerName)}", which ragPlugin does not declare. The provider ` +
                `fixes the column's dimension, so resolving this to the default one would emit ` +
                `a column of the wrong width. Declared providers: ` +
                `${declaredNames.length > 0 ? declaredNames.join(', ') : 'none'}.`,
            )
          }

          // A field that declared nothing took its provider's dimension in
          // `init`, so only an author's own value can disagree here.
          const declared = fieldConfig.dimensions
          if (declared === undefined) continue
          const providerConfig = providerFor(providerName)
          if (!providerConfig) continue

          const providerDimensions = knownDimensions(providerConfig)
          if (providerDimensions === undefined) continue
          if (declared === providerDimensions) continue

          throw new Error(
            `RAG plugin: "${listName}.${fieldName}" declares ${declared} ` +
              `dimensions, but its ${providerLabel(providerName ?? 'default', providerConfig)} ` +
              `produces ${providerDimensions}. The dimension is a column's type, so the two have ` +
              `to agree before a migration is planned.`,
          )
        }
      }

      return generateConfig
    },

    runtime: (context): RAGInternalServices => {
      const requireProvider = (providerName?: string) => {
        const providerConfig = providerFor(providerName)
        if (!providerConfig) {
          throw new Error(
            `RAG plugin: the provider "${String(providerName ?? 'default')}" is not declared by ` +
              `ragPlugin. A provider fixes the width of the vector it produces, so an ` +
              `undeclared name is refused rather than resolved to the default one — which is ` +
              `what pnpm generate refuses for an embedding field naming it. Declared ` +
              `providers: ${declaredProviderNames().join(', ') || 'none'}.`,
          )
        }
        return createEmbeddingProvider(providerConfig)
      }

      return {
        generateEmbedding: async (text: string, providerName?: string) =>
          await requireProvider(providerName).embed(text),

        generateEmbeddings: async (texts: string[], providerName?: string) =>
          await requireProvider(providerName).embedBatch(texts),

        [WRITE_EMBEDDING]: async (listKey, id, fieldName, stored) => {
          await writePluginOwnedField({
            context,
            listName: listKey,
            id,
            fieldName,
            value: stored,
          })
        },
      }
    },
  }
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
      'RAG plugin: context.plugins.rag is missing, so a generated embedding has no escalated ' +
        'write to reach its write-denied column through. The context was built without the plugin.',
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
