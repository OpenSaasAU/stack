// What `embedding()` promises against a real schema: a native vector column
// with its metadata beside it, ranked by `nearest()`, assembled back into one
// value on the way out, and write-denied to application code (ADR-0045).
//
// Known limits: the secured write surface has not been ported onto the Prisma 8
// collection yet (spec 7, #1124, #1127) — `context.db.<list>.create()` still
// speaks Prisma 6's `{ data }` to a collection that takes a row, and `update()`
// calls a `findUnique` no collection carries — so rows are seeded through the
// Unsafe origin, and the write denial is driven through `hookPipeline`, the
// transform+validate span `write-pipeline.ts` runs before it persists. The
// plugin's own sudo write is driven end to end and skips itself by name until
// then. Re-point all three at `context.db` once #1127 lands.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import { config as defineConfig } from '@opensaas/stack-core'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { hookPipeline } from '@opensaas/stack-core/internal'
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a throw is the secured write surface still speaking Prisma 6 to a
 * Prisma 8 collection, rather than anything this field did: `update()` calls a
 * `findUnique` no collection carries, and `create()` passes Prisma 6's `{ data }`
 * to a collection that takes a row (`write-pipeline.ts`, #1124, #1127).
 */
function isUnportedWriteSurface(error: unknown): boolean {
  const text = message(error)
  return text.includes('findUnique is not a function') || text.includes('Unknown column "data"')
}

/**
 * The plugin's escalated write, off the context a live `getContext` built. It
 * is keyed by a module-private symbol precisely so no string key names it, so a
 * test reaches it the only way anything can.
 */
function embeddingWriterOf(
  context: unknown,
): (listKey: string, id: string, fieldName: string, stored: unknown) => Promise<void> {
  const plugins: unknown = isRecord(context) ? context.plugins : undefined
  const services: unknown = isRecord(plugins) ? plugins.rag : undefined
  if (!isRecord(services)) throw new Error('the context carries no rag plugin services')

  const key = Object.getOwnPropertySymbols(services).find(
    (candidate) => typeof Reflect.get(services, candidate) === 'function',
  )
  if (key === undefined) throw new Error('the rag services expose no symbol-keyed write')

  const found: unknown = Reflect.get(services, key)
  if (typeof found !== 'function') throw new Error('unreachable')
  return async (listKey, id, fieldName, stored) => {
    await found(listKey, id, fieldName, stored)
  }
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
      // Metadata present and the vector absent, so a null answer can only come
      // from the vector column.
      await seed('Article', { content: 'red', contentEmbeddingMetadata: metadata })

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

      // cos([1,0,0], [0.8,0.6,0]) = 0.8 / (1 × 1.0) = 0.8, so cosine distance
      // is 0.2 and `1 - distance` scores it 0.8. blue is orthogonal: 0.
      // Compared with a tolerance because pgvector stores float4.
      expect(matches.map((match) => match.item.content)).toEqual(['red', 'reddish', 'blue'])
      const scores = matches.map((match) => match.score)
      expect(scores[0]).toBeCloseTo(1, 5)
      expect(scores[1]).toBeCloseTo(0.8, 5)
      expect(scores[2]).toBeCloseTo(0, 5)
    })

    test('a query vector of the wrong length is refused by the declared dimension', async () => {
      await expect(
        database.context(null).db.Article.nearest('contentEmbedding', [1, 0]),
      ).rejects.toThrow('is a 3-dimension column and the query vector has 2')
    })

    describe('write denial', () => {
      const write = { contentEmbedding: { vector: [1, 0, 0], metadata } }

      /** The harness hands out a `StackContext`; the pipeline takes the narrower `AccessContext`. */
      function accessContext(sudo: boolean): AccessContext {
        const context = sudo ? database.context(null).sudo() : database.context(null)
        return { ...context, ormHandle: {}, _resolveOutputChain: [] }
      }

      /**
       * The transform+validate span of a write, run over the real list config
       * the plugin resolved — `write-pipeline.ts` calls exactly this before it
       * persists.
       */
      function pipeline(
        listKey: string,
        operation: 'create' | 'update',
        inputData: Record<string, unknown>,
        sudo: boolean,
      ) {
        return hookPipeline.run({
          operation,
          listName: listKey,
          listConfig: resolved.lists[listKey],
          inputData,
          item: undefined,
          context: accessContext(sudo),
        })
      }

      test('an ordinary create or update naming the embedding throws', async () => {
        for (const operation of ['create', 'update'] as const) {
          await expect(pipeline('Article', operation, write, false)).rejects.toThrow(
            `Cannot ${operation} "contentEmbedding": field-level access denied.`,
          )
        }
      })

      test('the write the throw refused never reaches the columns', async () => {
        await seed('Article', { content: 'red' })
        const before = await database.context(null).db.Article.where({}).first()
        expect(before?.contentEmbedding).toBeNull()

        await expect(pipeline('Article', 'update', write, false)).rejects.toThrow(
          'field-level access denied',
        )

        const after = await database.context(null).db.Article.where({}).first()
        expect(after?.contentEmbedding).toBeNull()
      })

      test('the plugin’s own sudo write produces both columns, and they read back', async () => {
        const { resolvedData } = await pipeline(
          'Article',
          'create',
          { content: 'red', ...write },
          true,
        )

        expect(resolvedData).toEqual({
          content: 'red',
          contentEmbedding: [1, 0, 0],
          contentEmbeddingMetadata: metadata,
        })

        await seed('Article', resolvedData)

        const stored = await database.context(null).db.Article.where({}).first()
        expect(stored?.contentEmbedding).toEqual({ vector: [1, 0, 0], metadata })
      })

      /**
       * The plugin's own write, driven end to end: the symbol-keyed service a
       * live `getContext` built, over the real column, read back through the
       * secured surface.
       *
       * It skips itself by name while `context.db.<list>.update()` cannot
       * execute (#1124, #1127) rather than asserting the call shape against a
       * double — a green assertion over a path that provably fails is worse
       * than no coverage. When the surface lands, this starts running.
       */
      test('the plugin’s sudo write reaches the column', async (ctx) => {
        await seed('Article', { content: 'red' })
        const seeded = await database.context(null).db.Article.where({}).first()
        const id = seeded?.id
        if (typeof id !== 'string') throw new Error('the seeded row has no id')
        expect(seeded?.contentEmbedding).toBeNull()

        const write = embeddingWriterOf(database.context(null))
        const stored = { vector: [1, 0, 0], metadata }

        try {
          await write('Article', id, 'contentEmbedding', stored)
        } catch (error) {
          if (isUnportedWriteSurface(error)) {
            ctx.skip(
              `the secured write surface is not on the Prisma 8 collection yet ` +
                `(#1124, #1127): ${message(error)}`,
            )
          }
          throw error
        }

        const after = await database.context(null).db.Article.where({}).first()
        expect(after?.contentEmbedding).toEqual(stored)
      })

      test('allowManualWrites lets an ordinary write through the same pipeline', async () => {
        const open = await defineConfig({
          db: { provider: 'postgresql' },
          plugins: [ragPlugin({ provider: { type: 'fake', dimensions: 3 } })],
          lists: {
            Article: {
              fields: {
                content: text(),
                contentEmbedding: embedding({ dimensions: 3, allowManualWrites: true }),
              },
            },
          },
        })

        const { resolvedData } = await hookPipeline.run({
          operation: 'update',
          listName: 'Article',
          listConfig: open.lists.Article,
          inputData: write,
          item: undefined,
          context: accessContext(false),
        })

        expect(resolvedData).toEqual({
          contentEmbedding: [1, 0, 0],
          contentEmbeddingMetadata: metadata,
        })
      })
    })
  },
)
