// What `embedding()` promises against a real schema: a native vector column
// with its metadata beside it, ranked by `nearest()`, assembled back into one
// value on the way out, and write-denied to application code (ADR-0045).
//
// Known limits: the secured write surface has not been ported onto the Prisma 8
// collection yet (spec 7, #1127) — `context.db.<list>.create()` still speaks
// Prisma 6's `{ data }` to a collection that takes a row — so rows are seeded
// through the Unsafe origin, the write denial is asserted against the evaluator
// the Write Pipeline gates on, and the plugin's generation hook is driven
// directly. Re-point those three at `context.db` once #1127 lands.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import { config as defineConfig } from '@opensaas/stack-core'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { checkFieldAccess } from '@opensaas/stack-core/internal'
import { text } from '@opensaas/stack-core/fields'
import { withOrigin } from '@opensaas/stack-core/origin'
import {
  createTestDatabase,
  ESCAPE_VARIABLE,
  readDatabaseEscape,
  type TestDatabase,
} from '@opensaas/stack-core/testing'
import { registerEmbeddingProvider } from '../providers/index.js'
import type { EmbeddingProvider } from '../providers/types.js'
import { embedding } from '../fields/embedding.js'
import { ragPlugin } from './plugin.js'

const BOOT = 120_000

/**
 * A provider whose output is a pure function of its text, so an assertion on
 * the ranking is about the column and the terminal rather than about a model.
 */
const VECTORS: Record<string, number[]> = {
  red: [1, 0, 0],
  reddish: [0.8, 0.6, 0],
  blue: [0, 1, 0],
}

const fakeProvider: EmbeddingProvider = {
  type: 'fake',
  model: 'fake-3',
  dimensions: 3,
  embed: async (input: string) => {
    const vector = VECTORS[input]
    if (vector === undefined) throw new Error(`the fake provider has no vector for "${input}"`)
    return vector
  },
  embedBatch: async (inputs: string[]) =>
    await Promise.all(inputs.map((input) => fakeProvider.embed(input))),
}

registerEmbeddingProvider('fake', () => fakeProvider)

const source: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  plugins: [ragPlugin({ provider: { type: 'fake', dimensions: 3 } })],
  lists: {
    Article: {
      fields: {
        content: text(),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

const metadata = {
  model: 'fake-3',
  provider: 'fake',
  dimensions: 3,
  generatedAt: '2026-01-01T00:00:00.000Z',
}

let database: TestDatabase
let resolved: OpenSaasConfig

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The client's own collection, as the harness exposes it (ADR-0057). */
function collection(model: string): Record<string, unknown> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const found: unknown = Reflect.get(namespace, model)
  if (!isRecord(found)) throw new Error(`no collection "${model}"`)
  return found
}

function seed(model: string, row: object): Promise<void> {
  const target = collection(model)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => {
    await create.call(target, row)
  })
}

/**
 * PGlite bundles pgvector, so the default harness always runs this suite. A
 * server reached through the escape must have been provisioned with it
 * (ADR-0065); one that was not skips by name rather than failing.
 */
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
    ? 'the embedding column'
    : `the embedding column [skipped: the ${ESCAPE_VARIABLE} server has no pgvector]`,
  () => {
    beforeAll(async () => {
      resolved = await defineConfig(source)
      database = await createTestDatabase(resolved)
    }, BOOT)

    afterAll(async () => {
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
    })

    test('the two columns read back as one stored embedding', async () => {
      await seed('Article', {
        content: 'red',
        contentEmbedding: [1, 0, 0],
        contentEmbeddingMetadata: metadata,
      })

      const stored = await database.context(null).db.Article.where({}).first()

      expect(stored?.contentEmbedding).toEqual({ vector: [1, 0, 0], metadata })
      expect(stored).not.toHaveProperty('contentEmbeddingMetadata')
    })

    test('a row with no vector reads back as a null embedding', async () => {
      await seed('Article', { content: 'red' })

      const stored = await database.context(null).db.Article.where({}).first()

      expect(stored?.contentEmbedding).toBeNull()
    })

    test('nearest ranks by the column the field declares', async () => {
      for (const [content, vector] of Object.entries(VECTORS)) {
        await seed('Article', {
          content,
          contentEmbedding: vector,
          contentEmbeddingMetadata: metadata,
        })
      }

      const matches = await database.context(null).db.Article.nearest('contentEmbedding', [1, 0, 0])

      // Cosine distance from [1,0,0] is 0 for red, 0.2 for reddish, 1 for blue.
      expect(matches.map((match) => match.item.content)).toEqual(['red', 'reddish', 'blue'])
      expect(matches.map((match) => match.score)).toEqual([1, 0.8, 0])
    })

    test('a query vector of the wrong length is refused by the declared dimension', async () => {
      await expect(
        database.context(null).db.Article.nearest('contentEmbedding', [1, 0]),
      ).rejects.toThrow('is a 3-dimension column and the query vector has 2')
    })

    describe('write denial', () => {
      const write = { contentEmbedding: { vector: [1, 0, 0], metadata } }

      function fieldAccess(listKey: string, fieldKey: string) {
        return resolved.lists[listKey].fields[fieldKey].access
      }

      /** The harness hands out a `StackContext`; the evaluator takes the narrower `AccessContext`. */
      function accessContext(sudo: boolean): AccessContext {
        const context = sudo ? database.context(null).sudo() : database.context(null)
        return { ...context, ormHandle: {}, _resolveOutputChain: [] }
      }

      test('an ordinary create and update are denied', async () => {
        const context = accessContext(false)

        for (const operation of ['create', 'update'] as const) {
          expect(
            await checkFieldAccess(fieldAccess('Article', 'contentEmbedding'), operation, {
              session: null,
              context,
              inputData: write,
            }),
          ).toBe(false)
        }
      })

      test('the plugin’s own sudo write passes the same rule', async () => {
        const context = accessContext(true)

        expect(
          await checkFieldAccess(fieldAccess('Article', 'contentEmbedding'), 'update', {
            session: null,
            context,
            inputData: write,
          }),
        ).toBe(true)
      })

      test('allowManualWrites leaves an ordinary write allowed', async () => {
        const context = accessContext(false)
        const open = embedding({ dimensions: 3, allowManualWrites: true })

        expect(
          await checkFieldAccess(open.access, 'update', {
            session: null,
            context,
            inputData: write,
          }),
        ).toBe(true)
      })
    })
  },
)
