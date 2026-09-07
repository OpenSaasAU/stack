import { afterEach, describe, it, expect, vi } from 'vitest'
import { ragPlugin } from './plugin.js'
import type { RAGConfig } from './types.js'
import type { FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import type { AccessContext } from '@opensaas/stack-core'
import type { ContractColumnDescriptor, Plugin, PluginContext } from '@opensaas/stack-core/extend'
import { embedding } from '../fields/embedding.js'
import { text } from '@opensaas/stack-core/fields'
import { registerEmbeddingProvider } from '../providers/index.js'
import type { EmbeddingProvider } from '../providers/types.js'
import type { StoredEmbedding } from '../index.js'

const openai: RAGConfig = { provider: { type: 'openai', apiKey: 'test-key' } }

const counting: EmbeddingProvider = {
  type: 'counting',
  model: 'counting-1',
  dimensions: 1,
  embed: async (input: string) => [input.length],
  embedBatch: async (inputs: string[]) => inputs.map((input) => [input.length]),
}

registerEmbeddingProvider('counting', () => counting)

/** A provider that is down, the way OpenAI is down when it answers 429. */
const flaky: EmbeddingProvider = {
  type: 'flaky',
  model: 'flaky-1',
  dimensions: 1,
  embed: async () => {
    throw new Error('429 Too Many Requests')
  },
  embedBatch: async () => {
    throw new Error('429 Too Many Requests')
  },
}

registerEmbeddingProvider('flaky', () => flaky)

/**
 * Two providers of different widths, so a query vector says which one embedded
 * it. `nearest()` validates the vector against the column's declared dimension,
 * so on a real database the wrong one is a hard error rather than a bad answer.
 */
const narrow: EmbeddingProvider = {
  type: 'narrow',
  model: 'narrow-1',
  dimensions: 2,
  embed: async () => [1, 0],
  embedBatch: async (inputs: string[]) => inputs.map(() => [1, 0]),
}

registerEmbeddingProvider('narrow', () => narrow)

const wide: EmbeddingProvider = {
  type: 'wide',
  model: 'wide-1',
  dimensions: 4,
  embed: async () => [0, 0, 0, 1],
  embedBatch: async (inputs: string[]) => inputs.map(() => [0, 0, 0, 1]),
}

registerEmbeddingProvider('wide', () => wide)

function unreachable(): never {
  throw new Error('this member of the double was not expected to be reached')
}

function stubContext(overrides: Partial<AccessContext>): AccessContext {
  return {
    session: null,
    ormHandle: {},
    db: {},
    storage: {
      uploadFile: unreachable,
      uploadImage: unreachable,
      deleteFile: unreachable,
      deleteImage: unreachable,
    },
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
    ...overrides,
  }
}

/**
 * A `db` surface that records which list keys were reached through it, and
 * answers every method on the delegate. It pins no call shape: the point is
 * which context a write ran on, not what it called.
 */
function recordingDb(reached: string[]): AccessContext['db'] {
  const surface: AccessContext['db'] = {}
  return new Proxy(surface, {
    get: (_target, key) => {
      if (typeof key !== 'string') return undefined
      reached.push(key)
      return new Proxy({}, { get: () => async () => null })
    },
  })
}

type EmbeddingWriter = (
  listKey: string,
  id: string | number,
  fieldName: string,
  stored: StoredEmbedding,
) => Promise<void>

/**
 * The plugin's escalated write is keyed by a symbol the package does not
 * export, so this is the only way anything outside the plugin can reach it —
 * and the reason a generated project cannot.
 */
function writeEmbeddingOf(services: unknown): { key: symbol; write: EmbeddingWriter } {
  if (typeof services !== 'object' || services === null) {
    throw new Error('the plugin runtime returned no services object')
  }
  const key = Object.getOwnPropertySymbols(services).find(
    (candidate) => typeof Reflect.get(services, candidate) === 'function',
  )
  if (key === undefined) {
    throw new Error('the plugin runtime exposes no symbol-keyed embedding writer')
  }
  const found: unknown = Reflect.get(services, key)
  if (typeof found !== 'function') throw new Error('unreachable')
  return {
    key,
    write: async (listKey, id, fieldName, stored) => {
      await found(listKey, id, fieldName, stored)
    },
  }
}

type McpTool = Parameters<NonNullable<PluginContext['registerMcpTool']>>[0]

/** A `PluginContext` double that records the five verbs a plugin drives it through. */
function pluginContext(config: Partial<OpenSaasConfig> & { lists: OpenSaasConfig['lists'] }) {
  const live: OpenSaasConfig = { db: { provider: 'postgresql' }, ...config }
  const extensions: { name: string; from: string }[] = []
  const mcpTools: McpTool[] = []
  const pluginData: Record<string, unknown> = {}

  const context: PluginContext = {
    config: live,
    addList: vi.fn(),
    extendList: vi.fn((listName: string, extension: Record<string, unknown>) => {
      const target = live.lists[listName]
      const fields: unknown = extension.fields
      if (fields && typeof fields === 'object') {
        Object.assign(target.fields, fields)
      }
      const hooks: unknown = extension.hooks
      if (hooks && typeof hooks === 'object') {
        target.hooks = { ...target.hooks, ...hooks }
      }
    }),
    registerFieldType: vi.fn(),
    registerMcpTool: vi.fn((tool: McpTool) => {
      mcpTools.push(tool)
    }),
    addExtension: vi.fn((descriptor: { name: string; from: string }) => {
      extensions.push(descriptor)
    }),
    setPluginData: vi.fn((name: string, data: unknown) => {
      pluginData[name] = data
    }),
  }

  return { context, live, extensions, mcpTools, pluginData }
}

// vi.spyOn returns the EXISTING mock when the property is already spied, so a
// test that fails before its own mockRestore() hands its console spy — and its
// recorded calls — to the next test.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('ragPlugin', () => {
  describe('plugin shape', () => {
    it('names itself and exposes the lifecycle hooks it uses', () => {
      const plugin = ragPlugin(openai)

      expect(plugin.name).toBe('rag')
      expect(typeof plugin.init).toBe('function')
      expect(typeof plugin.beforeGenerate).toBe('function')
      expect(typeof plugin.runtime).toBe('function')
    })

    it('conforms to the Plugin interface', () => {
      const plugin: Plugin = ragPlugin(openai)
      expect(plugin.name).toBe('rag')
    })
  })

  describe('extension pack', () => {
    it('declares pgvector by package name, so the app never spells it', async () => {
      const harness = pluginContext({ lists: { Article: { fields: { title: text() } } } })

      await ragPlugin(openai).init!(harness.context)

      expect(harness.extensions).toEqual([
        { name: 'pgvector', from: '@prisma/orm-extension-pgvector' },
      ])
    })
  })

  describe('init', () => {
    it('injects an embedding field for each searchable() field', async () => {
      const searchableField = { ...text(), _searchable: { embeddingFieldName: '' } }
      const harness = pluginContext({
        lists: { Article: { fields: { content: searchableField } } },
      })

      await ragPlugin(openai).init!(harness.context)

      const injected = harness.live.lists.Article.fields.contentEmbedding
      expect(injected).toBeDefined()
      expect(injected.type).toBe('embedding')
    })

    it('honours a custom embedding field name', async () => {
      const searchableField = { ...text(), _searchable: { embeddingFieldName: 'bodyVector' } }
      const harness = pluginContext({ lists: { Article: { fields: { body: searchableField } } } })

      await ragPlugin(openai).init!(harness.context)

      expect(harness.live.lists.Article.fields.bodyVector).toBeDefined()
      expect(harness.live.lists.Article.fields.bodyEmbedding).toBeUndefined()
    })

    it('refuses autoGenerate without a sourceField', async () => {
      const harness = pluginContext({
        lists: {
          Article: { fields: { contentEmbedding: embedding({ autoGenerate: true }) } },
        },
      })

      await expect(ragPlugin(openai).init!(harness.context)).rejects.toThrow(
        'RAG plugin: Field "Article.contentEmbedding" has autoGenerate enabled but no sourceField specified',
      )
    })

    it('leaves a field without autoGenerate unhooked', async () => {
      const harness = pluginContext({
        lists: {
          Article: {
            fields: { content: text(), contentEmbedding: embedding({ dimensions: 1536 }) },
          },
        },
      })

      await ragPlugin(openai).init!(harness.context)

      expect(harness.live.lists.Article.hooks?.afterTransaction).toBeUndefined()
    })

    /** The vector column the field would be lowered onto, as generation reads it. */
    function vectorColumn(
      field: FieldConfig,
      fieldName: string,
      live: OpenSaasConfig,
    ): ContractColumnDescriptor {
      const descriptor = field.getContractField?.(fieldName, 'Article', live)
      if (descriptor === undefined || descriptor.kind !== 'columns') {
        throw new Error(`"${fieldName}" emits no columns`)
      }
      return descriptor.columns[0]
    }

    it('takes an undeclared dimension from the provider, so searchable() need not repeat it', async () => {
      const searchableField = { ...text(), _searchable: { provider: 'ollama' } }
      const harness = pluginContext({
        lists: { Article: { fields: { content: searchableField } } },
      })
      const plugin = ragPlugin({
        provider: { type: 'ollama', model: 'nomic-embed-text', dimensions: 768 },
      })

      await plugin.init!(harness.context)

      const injected = harness.live.lists.Article.fields.contentEmbedding
      expect(vectorColumn(injected, 'contentEmbedding', harness.live).type).toEqual({
        pack: 'pgvector',
        type: 'Vector',
        args: [768],
      })
      expect(() => plugin.beforeGenerate!(harness.live)).not.toThrow()
    })

    it('reaches the 1536 default only when the provider declares no dimension', async () => {
      const harness = pluginContext({
        lists: {
          Article: {
            fields: { content: text(), contentEmbedding: embedding({ sourceField: 'content' }) },
          },
        },
      })

      await ragPlugin({ provider: { type: 'in-memory' } }).init!(harness.context)

      const column = vectorColumn(
        harness.live.lists.Article.fields.contentEmbedding,
        'contentEmbedding',
        harness.live,
      )
      expect(column.type).toEqual({ pack: 'pgvector', type: 'Vector', args: [1536] })
    })

    it('stores the normalized config for runtime access', async () => {
      const harness = pluginContext({ lists: { Article: { fields: { title: text() } } } })

      await ragPlugin({ ...openai, batchSize: 25 }).init!(harness.context)

      expect(harness.pluginData.rag).toMatchObject({ batchSize: 25, enableMcpTools: true })
    })
  })

  describe('MCP tools', () => {
    it('registers one search tool per list with an embedding field', async () => {
      const harness = pluginContext({
        lists: {
          Article: {
            fields: { content: text(), contentEmbedding: embedding({ sourceField: 'content' }) },
          },
          Tag: { fields: { name: text() } },
        },
      })

      await ragPlugin(openai).init!(harness.context)

      expect(harness.mcpTools.map((tool) => tool.name)).toEqual(['semantic_search_article'])
      expect(harness.mcpTools[0].inputSchema.properties.field.enum).toEqual(['contentEmbedding'])
    })

    it('registers nothing when MCP tools are disabled', async () => {
      const harness = pluginContext({
        lists: {
          Article: {
            fields: { content: text(), contentEmbedding: embedding({ sourceField: 'content' }) },
          },
        },
      })

      await ragPlugin({ ...openai, enableMcpTools: false }).init!(harness.context)

      expect(harness.mcpTools).toEqual([])
    })

    /**
     * The search tool over a list whose embedding field names `wide` while the
     * plugin's default provider is `narrow`, plus a `nearest()` that records
     * what it was handed.
     */
    async function searchTool() {
      const harness = pluginContext({
        lists: {
          Article: {
            fields: {
              content: text(),
              contentEmbedding: embedding({
                sourceField: 'content',
                provider: 'wide',
                dimensions: 4,
              }),
            },
          },
        },
      })

      await ragPlugin({
        provider: { type: 'narrow', dimensions: 2 },
        providers: { wide: { type: 'wide', dimensions: 4 } },
      }).init!(harness.context)

      const calls: { field: string; vector: readonly number[]; options: unknown }[] = []
      const surface: AccessContext['db'] = {}
      const db = new Proxy(surface, {
        get: (_target, _listKey) =>
          new Proxy(
            {},
            {
              get: (_delegate, member) =>
                member === 'nearest'
                  ? async (field: string, vector: readonly number[], options: unknown) => {
                      calls.push({ field, vector, options })
                      return []
                    }
                  : unreachable,
            },
          ),
      })

      return { tool: harness.mcpTools[0], calls, context: stubContext({ db }) }
    }

    it("embeds the query with the searched field's own provider, not the default", async () => {
      const { tool, calls, context } = await searchTool()

      await tool.handler({ input: { query: 'anything' }, context })

      // `wide` answers [0, 0, 0, 1]; the default `narrow` answers [1, 0]. The
      // column is vector(4), so the default's vector is refused outright by a
      // real `nearest()`.
      expect(calls).toHaveLength(1)
      expect(calls[0].field).toBe('contentEmbedding')
      expect(calls[0].vector).toEqual([0, 0, 0, 1])
    })

    it('names no bound at all when the caller names none', async () => {
      const { tool, calls, context } = await searchTool()

      await tool.handler({ input: { query: 'anything' }, context })

      // `0` is a different bound on each of the three distance functions — no
      // predicate on `l2`, raw cosine >= 0 on `cosine`, and dot >= 0 on
      // `inner_product`, which silently drops every opposed row. Omitting it
      // is the only default that means the same thing on all three; see
      // `search.test.ts`'s per-distance-function tests.
      expect(calls[0].options).toEqual({ limit: 10 })
      expect(tool.inputSchema.properties.minScore.default).toBeUndefined()
    })

    it('passes the caller-supplied bounds through unchanged', async () => {
      const { tool, calls, context } = await searchTool()

      await tool.handler({ input: { query: 'anything', limit: 3, minScore: -0.25 }, context })

      expect(calls[0].options).toEqual({ limit: 3, minScore: -0.25 })
    })

    it('describes minScore on the distance function rather than as a 0-1 score', async () => {
      const harness = pluginContext({
        lists: {
          Article: {
            fields: { content: text(), contentEmbedding: embedding({ sourceField: 'content' }) },
          },
        },
      })

      await ragPlugin(openai).init!(harness.context)

      const description: unknown = harness.mcpTools[0].inputSchema.properties.minScore.description
      expect(description).toEqual(expect.stringContaining('[-1, 1]'))
      expect(description).toEqual(expect.stringContaining('unbounded'))
      expect(description).not.toEqual(expect.stringContaining('(0-1)'))
    })

    it('refuses a field the list carries no embedding on', async () => {
      const { tool, calls, context } = await searchTool()

      await expect(
        tool.handler({ input: { query: 'anything', field: 'content' }, context }),
      ).rejects.toThrow('"content" is not an embedding field of Article')
      expect(calls).toEqual([])
    })

    it('refuses a query that is not a string', async () => {
      const { tool, calls, context } = await searchTool()

      await expect(tool.handler({ input: { query: 42 }, context })).rejects.toThrow(
        '"query" must be a string',
      )
      expect(calls).toEqual([])
    })

    /**
     * `handleCustomTool` validates an `inputSchema` only when it is a Zod
     * schema, and this tool's is a plain JSON Schema — so the handler's own
     * narrowing is the only check there is. Defaulting a wrongly-typed
     * argument answers a different question than the caller asked: `field: 42`
     * had reached the default column *past* the unknown-field refusal, and
     * `minScore: "0.8"` had become a bound of `0` — on a cosine column a real
     * predicate (cosine ≥ 0), the loosest one, not the tight one asked for.
     */
    it.each([
      ['field', { query: 'anything', field: 42 }, '"field" must be a string'],
      ['minScore', { query: 'anything', minScore: '0.8' }, '"minScore" must be a finite number'],
      ['limit', { query: 'anything', limit: '3' }, '"limit" must be a finite number'],
    ])('refuses a wrongly-typed %s rather than defaulting it', async (_name, input, message) => {
      const { tool, calls, context } = await searchTool()

      await expect(tool.handler({ input, context })).rejects.toThrow(message)
      expect(calls).toEqual([])
    })
  })

  describe('the generation path', () => {
    /**
     * A context carrying the plugin's own sudo write, keyed by the symbol a
     * live runtime uses — the only key the plugin's hook looks under.
     */
    function writeRecorder(onWrite?: () => void) {
      const writes: {
        listKey: string
        id: string | number
        fieldName: string
        stored: StoredEmbedding
      }[] = []
      const { key } = writeEmbeddingOf(
        ragPlugin({ provider: { type: 'counting', dimensions: 1 } }).runtime!(stubContext({}), () =>
          stubContext({}),
        ),
      )
      const services: Record<symbol, EmbeddingWriter> = {
        [key]: async (listKey, id, fieldName, stored) => {
          onWrite?.()
          writes.push({ listKey, id, fieldName, stored })
        },
      }
      return { writes, context: stubContext({ plugins: { rag: services } }) }
    }

    /**
     * The `afterTransaction` hook the plugin injects, plus the writes the
     * runtime service it calls would make.
     */
    async function generationHook(providerName = 'counting', onWrite?: () => void) {
      const harness = pluginContext({
        lists: {
          Article: {
            fields: {
              content: text(),
              contentEmbedding: embedding({
                sourceField: 'content',
                provider: providerName,
                dimensions: 1,
              }),
            },
          },
        },
      })
      await ragPlugin({
        providers: {
          counting: { type: 'counting', dimensions: 1 },
          flaky: { type: 'flaky', dimensions: 1 },
          // Declared by ragPlugin, but no factory answers to the type — the
          // permanent configuration defect createEmbeddingProvider refuses.
          ghost: { type: 'ghost', dimensions: 1 },
        },
      }).init!(harness.context)

      const recorder = writeRecorder(onWrite)
      const hook = harness.live.lists.Article.hooks?.afterTransaction

      return { hook, writes: recorder.writes, context: recorder.context }
    }

    it('writes the embedding a committed create never named', async () => {
      const { hook, writes, context } = await generationHook()

      await hook!({
        listKey: 'Article',
        operation: 'create',
        status: 'committed',
        inputData: { content: 'four' },
        item: { id: 'a1', content: 'four', contentEmbedding: null },
        context,
      })

      expect(writes).toEqual([
        {
          listKey: 'Article',
          id: 'a1',
          fieldName: 'contentEmbedding',
          stored: {
            vector: [4],
            metadata: expect.objectContaining({
              model: 'counting-1',
              provider: 'counting',
              dimensions: 1,
            }),
          },
        },
      ])
    })

    it('writes nothing for a rolled-back write', async () => {
      const { hook, writes, context } = await generationHook()

      await hook!({
        listKey: 'Article',
        operation: 'create',
        status: 'rolled-back',
        inputData: { content: 'four' },
        error: new Error('nope'),
        context,
      })

      expect(writes).toEqual([])
    })

    it('embeds the persisted source text an update never named', async () => {
      const { hook, writes, context } = await generationHook()

      await hook!({
        listKey: 'Article',
        operation: 'update',
        status: 'committed',
        inputData: { published: true },
        originalItem: { id: 'a1', content: 'four' },
        item: { id: 'a1', content: 'four' },
        context,
      })

      expect(writes.map((write) => write.stored.vector)).toEqual([[4]])
    })

    it('logs rather than throws when the provider fails, since the row is committed', async () => {
      const { hook, writes, context } = await generationHook('flaky')
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(
        hook!({
          listKey: 'Article',
          operation: 'create',
          status: 'committed',
          inputData: { content: 'four' },
          item: { id: 'a1', content: 'four', contentEmbedding: null },
          context,
        }),
      ).resolves.toBeUndefined()

      expect(writes).toEqual([])
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('"Article.contentEmbedding" was not embedded for Article a1'),
        expect.objectContaining({ message: '429 Too Many Requests' }),
      )
      expect(logged.mock.calls[0][0]).toContain('#1271')
      // A provider that is down is this row, this minute — reporting it as the
      // standing defect is the inverted misreport the split exists to prevent.
      expect(logged.mock.calls[0][0]).not.toContain('EMBEDDING GENERATION IS NOT RUNNING')
      logged.mockRestore()
    })

    it('reports a transient write failure as transient, not as the standing defect', async () => {
      // A reporter that keys on the code path rather than on the error calls
      // every write failure standing, and tells the reader no config change
      // works around a connection that dropped.
      const { hook, context } = await generationHook('counting', () => {
        throw new Error('connection reset by peer')
      })
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      await hook!({
        listKey: 'Article',
        operation: 'create',
        status: 'committed',
        inputData: { content: 'four' },
        item: { id: 'a1', content: 'four', contentEmbedding: null },
        context,
      })

      const said = logged.mock.calls[0][0]
      expect(said).toContain('"Article.contentEmbedding" was not embedded for Article a1')
      expect(said).toContain('retry by writing the source field again')
      expect(said).not.toContain('EMBEDDING GENERATION IS NOT RUNNING')
      logged.mockRestore()
    })

    it('reports an unregistered provider type as a standing defect, not as transient', async () => {
      // Building the provider is where a permanent configuration defect
      // surfaces, so a reporter that keys on the code path calls this one
      // transient — and tells the reader to retry a write that will fail
      // identically forever.
      const { hook, writes, context } = await generationHook('ghost')
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

      const committed = async (id: string) =>
        await hook!({
          listKey: 'Article',
          operation: 'create',
          status: 'committed',
          inputData: { content: 'four' },
          item: { id, content: 'four', contentEmbedding: null },
          context,
        })

      await expect(committed('a1')).resolves.toBeUndefined()
      await expect(committed('a2')).resolves.toBeUndefined()

      expect(writes).toEqual([])
      const first = logged.mock.calls[0][0]
      expect(first).toContain('EMBEDDING GENERATION IS NOT RUNNING for "Article.contentEmbedding"')
      expect(first).toContain('registerEmbeddingProvider')
      expect(first).not.toContain('retry by writing the source field again')
      // Said in full once, then one line per row, like the other standing one.
      expect(logged.mock.calls[1][0]).not.toContain('EMBEDDING GENERATION IS NOT RUNNING')
      expect(logged.mock.calls[1][0]).toContain('Article a2')
      logged.mockRestore()
    })

    it('warns that a nested record, which carries no persisted row, was not embedded', async () => {
      const { hook, writes, context } = await generationHook()
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await hook!({
        listKey: 'Article',
        operation: 'create',
        status: 'committed',
        inputData: { content: 'four' },
        item: undefined,
        context,
      })

      expect(writes).toEqual([])
      expect(warned).toHaveBeenCalledWith(
        expect.stringContaining('"Article.contentEmbedding" was not embedded'),
      )
      expect(warned.mock.calls[0][0]).toContain('#1271')
      warned.mockRestore()
    })

    it('writes nothing when the source text hashes to what is already stored', async () => {
      const { hook, writes, context } = await generationHook()

      await hook!({
        listKey: 'Article',
        operation: 'create',
        status: 'committed',
        inputData: { content: 'four' },
        item: { id: 'a1', content: 'four', contentEmbedding: null },
        context,
      })
      const first = writes[0].stored

      await hook!({
        listKey: 'Article',
        operation: 'update',
        status: 'committed',
        inputData: { content: 'four' },
        originalItem: { id: 'a1', content: 'four' },
        item: { id: 'a1', content: 'four', contentEmbedding: first },
        context,
      })

      expect(writes).toHaveLength(1)
    })

    it('regenerates when the source text changed', async () => {
      const { hook, writes, context } = await generationHook()

      await hook!({
        listKey: 'Article',
        operation: 'create',
        status: 'committed',
        inputData: { content: 'four' },
        item: { id: 'a1', content: 'four', contentEmbedding: null },
        context,
      })

      await hook!({
        listKey: 'Article',
        operation: 'update',
        status: 'committed',
        inputData: { content: 'eleven' },
        originalItem: { id: 'a1', content: 'four' },
        item: { id: 'a1', content: 'eleven', contentEmbedding: writes[0].stored },
        context,
      })

      expect(writes.map((write) => write.stored.vector)).toEqual([[4], [6]])
    })

    it('refuses to write when the context carries no rag services', async () => {
      const { hook } = await generationHook()

      await expect(
        hook!({
          listKey: 'Article',
          operation: 'create',
          status: 'committed',
          inputData: { content: 'four' },
          item: { id: 'a1', content: 'four' },
          context: stubContext({}),
        }),
      ).rejects.toThrow('context.plugins.rag is missing')
    })

    it('puts the escalated write on no string key of context.plugins.rag', () => {
      const plugin = ragPlugin({ provider: { type: 'counting', dimensions: 1 } })
      const services = plugin.runtime!(stubContext({}), () => stubContext({}))
      if (typeof services !== 'object' || services === null) {
        throw new Error('the plugin runtime returned no services object')
      }

      // String keys are the only kind a generated project, typed by
      // RAGRuntimeServices, could name.
      expect(Object.getOwnPropertyNames(services).sort()).toEqual([
        'generateEmbedding',
        'generateEmbeddings',
      ])
    })

    it('refuses an undeclared provider at runtime, the way generation refuses it', async () => {
      // Falling back to the default here embeds with a model of a different
      // width than the column the same name fixed, so the two paths have to
      // give the same answer.
      const services = ragPlugin({ provider: { type: 'counting', dimensions: 1 } }).runtime!(
        stubContext({}),
        () => stubContext({}),
      )
      const generate: unknown = Reflect.get(Object(services), 'generateEmbedding')
      if (typeof generate !== 'function') throw new Error('no generateEmbedding service')

      await expect(generate('four', 'ollama')).rejects.toThrow(
        'RAG plugin: the provider "ollama" is not declared by ragPlugin',
      )
      await expect(generate('four')).resolves.toEqual([4])
    })

    it('runs the escalated write on the context sudo() returns, not on the request one', async () => {
      // The escalation is the whole reason the writer lives on Plugin.runtime
      // (ADR-0045): a hook's AccessContext cannot derive a sudo one, and
      // without sudo the field's own write denial refuses the plugin's output.
      // Which context the write runs on is the assertion; what it calls on the
      // delegate is `embedding-write.test.ts`'s job, against a real column.
      const requestReached: string[] = []
      const sudoReached: string[] = []
      let escalations = 0

      const services = ragPlugin({ provider: { type: 'counting', dimensions: 1 } }).runtime!(
        stubContext({ db: recordingDb(requestReached) }),
        () => {
          escalations += 1
          return stubContext({ db: recordingDb(sudoReached), _isSudo: true })
        },
      )

      await writeEmbeddingOf(services).write('Article', 'a1', 'contentEmbedding', {
        vector: [4],
        metadata: {
          model: 'counting-1',
          provider: 'counting',
          dimensions: 1,
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      })

      expect(escalations).toBe(1)
      expect(sudoReached).toEqual(['Article'])
      expect(requestReached).toEqual([])
    })
  })

  describe('beforeGenerate', () => {
    const listsWith = (dimensions: number, provider?: string): OpenSaasConfig => ({
      db: { provider: 'postgresql' },
      lists: {
        Article: {
          fields: {
            content: text(),
            contentEmbedding: embedding({ sourceField: 'content', dimensions, provider }),
          },
        },
      },
    })

    it('passes when the declared dimension matches the provider model', () => {
      const plugin = ragPlugin({
        provider: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-large' },
      })

      expect(() => plugin.beforeGenerate!(listsWith(3072))).not.toThrow()
    })

    it('refuses a dimension that disagrees with a statically known provider dimension', () => {
      const plugin = ragPlugin({
        provider: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-large' },
      })

      expect(() => plugin.beforeGenerate!(listsWith(1536))).toThrow(
        'RAG plugin: "Article.contentEmbedding" declares 1536 dimensions, but its default ' +
          'provider "text-embedding-3-large" produces 3072. The dimension is a column\'s type, ' +
          'so the two have to agree before a migration is planned.',
      )
    })

    it('checks the named provider a field selects, not the default', () => {
      const plugin = ragPlugin({
        provider: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-small' },
        providers: {
          large: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-large' },
        },
      })

      expect(() => plugin.beforeGenerate!(listsWith(3072, 'large'))).not.toThrow()
      expect(() => plugin.beforeGenerate!(listsWith(1536, 'large'))).toThrow('produces 3072')
    })

    it('refuses an Ollama provider that declares no dimensions', () => {
      const plugin = ragPlugin({
        provider: { type: 'ollama', model: 'nomic-embed-text' } as never,
      })

      expect(() => plugin.beforeGenerate!(listsWith(768))).toThrow(
        'RAG plugin: the default provider "nomic-embed-text" declares no dimensions. Ollama ' +
          'reports its output size only from a live embed call, and generation must not depend ' +
          'on a running Ollama, so ollamaEmbeddings({ dimensions }) is required.',
      )
    })

    it('accepts an Ollama provider that declares its dimensions', () => {
      const plugin = ragPlugin({
        provider: { type: 'ollama', model: 'nomic-embed-text', dimensions: 768 },
      })

      expect(() => plugin.beforeGenerate!(listsWith(768))).not.toThrow()
      expect(() => plugin.beforeGenerate!(listsWith(1536))).toThrow('produces 768')
    })

    it('refuses a datasource no embedding column can be lowered onto', () => {
      const plugin = ragPlugin({ provider: { type: 'openai', apiKey: 'k' } })
      const onSqlite = listsWith(1536)
      Reflect.set(onSqlite.db, 'provider', 'sqlite')

      expect(() => plugin.beforeGenerate!(onSqlite)).toThrow(
        'RAG plugin: the datasource is "sqlite", and every column this plugin emits is ' +
          'Postgres-only',
      )
    })

    it('exempts a custom provider that declares no dimension', () => {
      const plugin = ragPlugin({ provider: { type: 'in-memory' } })

      expect(() => plugin.beforeGenerate!(listsWith(7))).not.toThrow()
    })

    it('refuses a field naming a provider the plugin does not declare', () => {
      const plugin = ragPlugin({
        provider: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-small' },
        providers: { large: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-large' } },
      })

      // Resolving this to the default would emit vector(1536) for a provider
      // the author never declared, and the dimension check below would agree
      // with itself, so nothing would refuse it.
      expect(() => plugin.beforeGenerate!(listsWith(1536, 'ollama'))).toThrow(
        'RAG plugin: "Article.contentEmbedding" names the provider "ollama", which ragPlugin ' +
          "does not declare. The provider fixes the column's dimension, so resolving this to " +
          'the default one would emit a column of the wrong width. Declared providers: ' +
          'default, openai, large.',
      )
    })

    it('refuses a provider name the prototype chain answers to', () => {
      const plugin = ragPlugin({
        provider: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-small' },
        providers: { large: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-large' } },
      })

      // `'toString' in providers` is true of every object literal, so the
      // lookup has to ask what this map declares, not what it inherits.
      expect(() => plugin.beforeGenerate!(listsWith(1536, 'toString'))).toThrow(
        'names the provider "toString", which ragPlugin does not declare',
      )
    })

    it('accepts a field naming a declared provider, or the default one by its type', () => {
      const plugin = ragPlugin({
        provider: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-small' },
        providers: { large: { type: 'openai', apiKey: 'k', model: 'text-embedding-3-large' } },
      })

      expect(() => plugin.beforeGenerate!(listsWith(3072, 'large'))).not.toThrow()
      expect(() => plugin.beforeGenerate!(listsWith(1536, 'openai'))).not.toThrow()
      expect(() => plugin.beforeGenerate!(listsWith(1536, 'default'))).not.toThrow()
      expect(() => plugin.beforeGenerate!(listsWith(1536))).not.toThrow()
    })
  })
})
