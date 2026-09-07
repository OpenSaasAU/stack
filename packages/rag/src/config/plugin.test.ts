import { describe, it, expect, vi } from 'vitest'
import { ragPlugin } from './plugin.js'
import type { RAGConfig } from './types.js'
import { config as defineConfig } from '@opensaas/stack-core'
import type { FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import type { AccessContext } from '@opensaas/stack-core'
import type { AccessControlledDelegate } from '@opensaas/stack-core/internal'
import { hookPipeline } from '@opensaas/stack-core/internal'
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

function unreachable(): never {
  throw new Error('this member of the double was not expected to be reached')
}

/** One secured list, with every member it does not exercise left as a tripwire. */
function delegate(overrides: Partial<AccessControlledDelegate>): AccessControlledDelegate {
  return {
    where: unreachable,
    orderBy: unreachable,
    include: unreachable,
    select: unreachable,
    limit: unreachable,
    offset: unreachable,
    distinct: unreachable,
    distinctOn: unreachable,
    cursor: unreachable,
    all: unreachable,
    first: unreachable,
    nearest: unreachable,
    aggregate: unreachable,
    findUnique: unreachable,
    findFirst: unreachable,
    findMany: unreachable,
    create: unreachable,
    update: unreachable,
    delete: unreachable,
    count: unreachable,
    createMany: unreachable,
    updateMany: unreachable,
    ...overrides,
  }
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
  })

  describe('the generation path', () => {
    /**
     * A context carrying the plugin's own sudo write, keyed by the symbol a
     * live runtime uses — the only key the plugin's hook looks under.
     */
    function writeRecorder() {
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
          writes.push({ listKey, id, fieldName, stored })
        },
      }
      return { writes, context: stubContext({ plugins: { rag: services } }) }
    }

    /**
     * The `afterTransaction` hook the plugin injects, plus the writes the
     * runtime service it calls would make.
     */
    async function generationHook(providerName = 'counting') {
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
        },
      }).init!(harness.context)

      const recorder = writeRecorder()
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

    it('embeds a source value a list-level resolveInput produced', async () => {
      const resolved = await defineConfig({
        db: { provider: 'postgresql' },
        plugins: [ragPlugin({ provider: { type: 'counting', dimensions: 1 } })],
        lists: {
          Article: {
            fields: {
              title: text(),
              body: text(),
              content: text(),
              contentEmbedding: embedding({ sourceField: 'content', dimensions: 1 }),
            },
            hooks: {
              resolveInput: ({ resolvedData }) => ({
                ...resolvedData,
                content: [resolvedData.title, resolvedData.body].join(' '),
              }),
            },
          },
        },
      })
      const recorder = writeRecorder()
      const inputData = { title: 'Four', body: 'score' }

      // The real transform span: `content` is derived here and named nowhere
      // in the input, which is what the old guard keyed on.
      const { resolvedData } = await hookPipeline.run({
        operation: 'create',
        listName: 'Article',
        listConfig: resolved.lists.Article,
        inputData,
        item: undefined,
        context: recorder.context,
      })
      expect(resolvedData.content).toBe('Four score')

      await resolved.lists.Article.hooks!.afterTransaction!({
        listKey: 'Article',
        operation: 'create',
        status: 'committed',
        inputData,
        item: { id: 'a1', ...resolvedData },
        context: recorder.context,
      })

      // 'Four score' is 10 characters, and the counting provider embeds a text
      // as its length.
      expect(recorder.writes.map((write) => write.stored.vector)).toEqual([[10]])
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

    it('writes through sudo, not through the request context', async () => {
      const plugin = ragPlugin({ provider: { type: 'counting', dimensions: 1 } })
      const requestUpdate = vi.fn()
      const sudoUpdate = vi.fn()
      const request = stubContext({ db: { Article: delegate({ update: requestUpdate }) } })
      const elevated = stubContext({ db: { Article: delegate({ update: sudoUpdate }) } })

      const { write } = writeEmbeddingOf(plugin.runtime!(request, () => elevated))
      const stored: StoredEmbedding = {
        vector: [4],
        metadata: {
          model: 'counting-1',
          provider: 'counting',
          dimensions: 1,
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      }
      await write('Article', 'a1', 'contentEmbedding', stored)

      expect(requestUpdate).not.toHaveBeenCalled()
      expect(sudoUpdate).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { contentEmbedding: stored },
      })
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
  })
})
