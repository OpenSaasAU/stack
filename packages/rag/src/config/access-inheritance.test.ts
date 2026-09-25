// A read-denied source field must not leak through its companion embedding:
// not the vector, not the sourceHash bundled in its metadata, and not a
// nearest() ranking (issue #1627, ADR-0045 amended). Exercised against a real
// pgvector column so the read denial, the predicate-time refusal and the RAG
// plugin's own MCP search tool are each proven against the real engine, not a
// double.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import { config as defineConfig } from '@opensaas/stack-core'
import type { FieldAccess, OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import {
  createTestDatabase,
  ESCAPE_VARIABLES,
  readDatabaseEscape,
  type TestDatabase,
} from '@opensaas/stack-core/testing'
import { registerEmbeddingProvider } from '../providers/index.js'
import type { EmbeddingProvider } from '../providers/types.js'
import { embedding } from '../fields/embedding.js'
import { searchable } from '../fields/searchable.js'
import { ragPlugin } from './plugin.js'

const BOOT = 120_000

/** A provider whose output is a pure function of its text. */
const VECTORS: Record<string, number[]> = {
  'alice salary 200k': [1, 0, 0],
  'bob salary 50k': [0, 1, 0],
  'owner-1 secret': [0, 0, 1],
}

let embedCalls = 0

const fakeProvider: EmbeddingProvider = {
  type: 'access-fake',
  model: 'access-fake-3',
  dimensions: 3,
  embed: async (input: string) => {
    embedCalls++
    const vector = VECTORS[input]
    if (vector === undefined) throw new Error(`the fake provider has no vector for "${input}"`)
    return vector
  },
  embedBatch: async (inputs: string[]) =>
    await Promise.all(inputs.map((input) => fakeProvider.embed(input))),
}

registerEmbeddingProvider('access-fake', () => fakeProvider)

const isAdmin: NonNullable<FieldAccess['read']> = ({ session }) => session?.admin === true

const admin = { admin: true }
const nonAdmin = { admin: false }

const source: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  plugins: [ragPlugin({ provider: { type: 'access-fake', dimensions: 3 } })],
  lists: {
    // searchable()-injected embedding, over a source field with a
    // row-independent read rule.
    Secret: {
      fields: {
        title: text(),
        content: searchable(text({ access: { read: isAdmin } }), { dimensions: 3 }),
      },
      access: { operation: { query: () => true, create: () => true, update: () => true } },
    },
    // Same shape, but embedding({ sourceField }) declared directly rather
    // than through searchable().
    Direct: {
      fields: {
        content: text({ access: { read: isAdmin } }),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    // A row-dependent source rule.
    Owned: {
      fields: {
        ownerId: text(),
        content: text({
          access: { read: ({ session, item }) => item?.ownerId === session?.userId },
        }),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    // The embedding's own `read: () => true` must not widen past a denied source.
    WidenAttempt: {
      fields: {
        content: text({ access: { read: isAdmin } }),
        contentEmbedding: embedding({
          sourceField: 'content',
          dimensions: 3,
          access: { read: () => true },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    // The embedding's own `read: () => false` must still narrow a readable source.
    NarrowAttempt: {
      fields: {
        content: text(),
        contentEmbedding: embedding({
          sourceField: 'content',
          dimensions: 3,
          access: { read: () => false },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    // A source field with no read rule at all: unaffected by the change.
    Open: {
      fields: {
        content: text(),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

let database: TestDatabase
let resolvedConfig: OpenSaasConfig

/** What `database.context(session)` hands back, over the default untyped harness. */
type Context = ReturnType<TestDatabase['context']>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A value nested under a row's field, reached without dot-typing a generic row. */
function fieldOf(row: unknown, key: string): unknown {
  return isRecord(row) ? Reflect.get(row, key) : undefined
}

interface CustomMcpTool {
  name: string
  handler: (args: { input: unknown; context: Context }) => Promise<unknown>
}

function isCustomMcpTool(value: unknown): value is CustomMcpTool {
  return isRecord(value) && typeof value.name === 'string' && typeof value.handler === 'function'
}

/** A plugin-registered MCP tool off the resolved config, the way the handler reaches it. */
function customTool(config: OpenSaasConfig, name: string): CustomMcpTool {
  const pluginData: unknown = config._pluginData
  const tools: unknown = isRecord(pluginData) ? pluginData.__mcpTools : undefined
  if (!Array.isArray(tools)) throw new Error('no plugin mcp tools were registered')
  const found = tools.find((tool) => isCustomMcpTool(tool) && tool.name === name)
  if (!isCustomMcpTool(found)) throw new Error(`no custom mcp tool named "${name}"`)
  return found
}

/** See `embedding-write.test.ts`: PGlite bundles pgvector; an escape server may not. */
const escape = readDatabaseEscape()
const available =
  escape.kind !== 'postgres' ||
  (await (async () => {
    const client = new pg.Client({ connectionString: escape.url })
    await client.connect()
    try {
      const result = await client.query(
        `select 1 from pg_available_extensions where name = 'vector'`,
      )
      return result.rowCount === 1
    } finally {
      await client.end()
    }
  })())

describe.skipIf(!available)(
  available
    ? 'a read-denied source field and its embedding'
    : `a read-denied source field and its embedding [skipped: the ${ESCAPE_VARIABLES.join('/')} server has no pgvector]`,
  () => {
    beforeAll(async () => {
      resolvedConfig = await defineConfig(source)
      database = await createTestDatabase(resolvedConfig)
    }, BOOT)

    afterAll(async () => {
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
      embedCalls = 0
    })

    describe('a searchable() field (the reported reproduction)', () => {
      test('a non-admin read has no contentEmbedding key', async () => {
        await database.context(admin).db.Secret.create({
          data: { title: 'alice', content: 'alice salary 200k' },
        })

        const row = await database.context(nonAdmin).db.Secret.where({}).first()

        expect(row).not.toHaveProperty('contentEmbedding')
        expect(row?.content).toBeUndefined()
      })

      test('an admin read still gets the embedding', async () => {
        await database.context(admin).db.Secret.create({
          data: { title: 'alice', content: 'alice salary 200k' },
        })

        const row = await database.context(admin).db.Secret.where({}).first()

        expect(fieldOf(fieldOf(row, 'contentEmbedding'), 'vector')).toEqual([1, 0, 0])
      })

      test('nearest() is refused for a session denied the source field', async () => {
        await database.context(admin).db.Secret.create({
          data: { title: 'alice', content: 'alice salary 200k' },
        })
        await database.context(admin).db.Secret.create({
          data: { title: 'bob', content: 'bob salary 50k' },
        })

        await expect(
          database.context(nonAdmin).db.Secret.nearest('contentEmbedding', [1, 0, 0]),
        ).rejects.toThrow(/contentEmbedding/)
      })

      test('nearest() ranks for a session that can read the source field', async () => {
        await database.context(admin).db.Secret.create({
          data: { title: 'alice', content: 'alice salary 200k' },
        })
        await database.context(admin).db.Secret.create({
          data: { title: 'bob', content: 'bob salary 50k' },
        })

        const matches = await database
          .context(admin)
          .db.Secret.nearest('contentEmbedding', [1, 0, 0])

        expect(matches.map((match) => match.item.title)).toEqual(['alice', 'bob'])
      })
    })

    describe('embedding({ sourceField }) declared directly', () => {
      test('a non-admin read has no contentEmbedding key', async () => {
        await database.context(admin).db.Direct.create({ data: { content: 'alice salary 200k' } })

        const row = await database.context(nonAdmin).db.Direct.where({}).first()

        expect(row).not.toHaveProperty('contentEmbedding')
      })

      test('nearest() is refused for a session denied the source field, and works for one that can', async () => {
        await database.context(admin).db.Direct.create({ data: { content: 'alice salary 200k' } })

        await expect(
          database.context(nonAdmin).db.Direct.nearest('contentEmbedding', [1, 0, 0]),
        ).rejects.toThrow(/contentEmbedding/)

        const matches = await database
          .context(admin)
          .db.Direct.nearest('contentEmbedding', [1, 0, 0])
        expect(matches).toHaveLength(1)
      })
    })

    describe('a row-dependent source rule', () => {
      test('hides the embedding on a row the session cannot read, and shows it on one it can', async () => {
        await database.context(admin).db.Owned.create({
          data: { ownerId: 'owner-1', content: 'owner-1 secret' },
        })

        const asOwner = await database.context({ userId: 'owner-1' }).db.Owned.where({}).first()
        expect(fieldOf(fieldOf(asOwner, 'contentEmbedding'), 'vector')).toEqual([0, 0, 1])

        const asSomeoneElse = await database
          .context({ userId: 'owner-2' })
          .db.Owned.where({})
          .first()
        expect(asSomeoneElse).not.toHaveProperty('contentEmbedding')
      })
    })

    describe('composing with the embedding field’s own access.read', () => {
      test('an author-supplied read:true cannot widen past a denied source', async () => {
        await database
          .context(admin)
          .db.WidenAttempt.create({ data: { content: 'alice salary 200k' } })

        const row = await database.context(nonAdmin).db.WidenAttempt.where({}).first()

        expect(row).not.toHaveProperty('contentEmbedding')
      })

      test('an author-supplied read:false still narrows a readable source', async () => {
        await database
          .context(admin)
          .db.NarrowAttempt.create({ data: { content: 'alice salary 200k' } })

        const row = await database.context(nonAdmin).db.NarrowAttempt.where({}).first()

        expect(row).not.toHaveProperty('contentEmbedding')
      })
    })

    test('a source with no read rule leaves the embedding readable, as before', async () => {
      await database.context(admin).db.Open.create({ data: { content: 'alice salary 200k' } })

      const row = await database.context(nonAdmin).db.Open.where({}).first()

      expect(fieldOf(fieldOf(row, 'contentEmbedding'), 'vector')).toEqual([1, 0, 0])
    })

    test('an update with unchanged source text still skips regeneration behind the read denial', async () => {
      const created = await database.context(admin).db.Secret.create({
        data: { title: 'alice', content: 'alice salary 200k' },
      })
      expect(embedCalls).toBe(1)

      await database.context(admin).db.Secret.update({
        where: { id: created?.id },
        data: { title: 'alice, updated' },
      })

      expect(embedCalls).toBe(1)
    })

    describe('the semantic search MCP tool', () => {
      test('refuses a session that cannot read the source field', async () => {
        await database.context(admin).db.Secret.create({
          data: { title: 'alice', content: 'alice salary 200k' },
        })
        const tool = customTool(resolvedConfig, 'semantic_search_secret')

        await expect(
          tool.handler({
            input: { query: 'alice salary 200k' },
            context: database.context(nonAdmin),
          }),
        ).rejects.toThrow()
      })

      test('works for a session that can read the source field', async () => {
        await database.context(admin).db.Secret.create({
          data: { title: 'alice', content: 'alice salary 200k' },
        })
        const tool = customTool(resolvedConfig, 'semantic_search_secret')

        const result = await tool.handler({
          input: { query: 'alice salary 200k' },
          context: database.context(admin),
        })

        expect(result).toMatchObject({ count: 1 })
      })
    })
  },
)
