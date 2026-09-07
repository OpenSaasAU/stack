// `semanticSearch()` and `findSimilar()` against a real vector column: what the
// helpers add over `nearest()` is embedding the query and locating the source
// item, so both are driven end to end rather than against a double.
//
// Known limits: the secured write surface has not been ported onto the Prisma 8
// collection yet (#1124), so rows are seeded through the Unsafe origin, the
// same seam `embedding-write.test.ts` uses. Reads and `nearest()` are live.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import { config as defineConfig } from '@opensaas/stack-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, checkbox } from '@opensaas/stack-core/fields'
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
import { ragPlugin } from '../config/plugin.js'
import { findSimilar, semanticSearch } from './search.js'

const BOOT = 120_000

/** A provider whose output is a pure function of its text (see `embedding-write.test.ts`). */
const VECTORS: Record<string, number[]> = {
  red: [1, 0, 0],
  reddish: [0.8, 0.6, 0],
  blue: [0, 1, 0],
}

const searchProvider: EmbeddingProvider = {
  type: 'search-fake',
  model: 'search-fake-3',
  dimensions: 3,
  embed: async (input: string) => {
    const vector = VECTORS[input]
    if (vector === undefined) throw new Error(`the fake provider has no vector for "${input}"`)
    return vector
  },
  embedBatch: async (inputs: string[]) =>
    await Promise.all(inputs.map((input) => searchProvider.embed(input))),
}

registerEmbeddingProvider('search-fake', () => searchProvider)

const source: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  plugins: [ragPlugin({ provider: { type: 'search-fake', dimensions: 3 } })],
  lists: {
    Article: {
      fields: {
        content: text(),
        published: checkbox(),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

const metadata = {
  model: 'search-fake-3',
  provider: 'search-fake',
  dimensions: 3,
  generatedAt: '2026-01-01T00:00:00.000Z',
}

let database: TestDatabase

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

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

async function seedPalette(published = true): Promise<void> {
  for (const [content, vector] of Object.entries(VECTORS)) {
    await seed('Article', {
      content,
      published,
      contentEmbedding: vector,
      contentEmbeddingMetadata: metadata,
    })
  }
}

function list() {
  return database.context(null).db.Article
}

async function idOf(content: string): Promise<string> {
  const row = await list()
    .where({ content: { equals: content } })
    .first()
  const id: unknown = row?.id
  if (typeof id !== 'string') throw new Error(`no "${content}" row to search from`)
  return id
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
    ? 'the search helpers'
    : `the search helpers [skipped: the ${ESCAPE_VARIABLE} server has no pgvector]`,
  () => {
    beforeAll(async () => {
      database = await createTestDatabase(await defineConfig(source))
    }, BOOT)

    afterAll(async () => {
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
    })

    describe('semanticSearch', () => {
      test('embeds the query and ranks the list it was given', async () => {
        await seedPalette()

        const results = await semanticSearch({
          list: list(),
          fieldName: 'contentEmbedding',
          query: 'red',
          provider: searchProvider,
        })

        // cos([1,0,0], [0.8,0.6,0]) = 0.8 / (1 × 1) = 0.8; blue is orthogonal.
        // Compared with a tolerance because pgvector stores float4.
        expect(results.map((result) => result.item.content)).toEqual(['red', 'reddish', 'blue'])
        expect(results[0].score).toBeCloseTo(1, 5)
        expect(results[1].score).toBeCloseTo(0.8, 5)
        expect(results[2].score).toBeCloseTo(0, 5)
      })

      test('scopes the ranking by the where it was given', async () => {
        await seedPalette()
        await seed('Article', {
          content: 'red',
          published: false,
          contentEmbedding: VECTORS.red,
          contentEmbeddingMetadata: metadata,
        })

        const results = await semanticSearch({
          list: list(),
          fieldName: 'contentEmbedding',
          query: 'red',
          provider: searchProvider,
          where: { published: { equals: false } },
        })

        expect(results).toHaveLength(1)
        expect(results[0].score).toBeCloseTo(1, 5)
      })

      test('bounds the result set by minScore, on the raw cosine', async () => {
        await seedPalette()

        // 0.8 keeps red (1) and reddish (0.8) and drops blue (0). On the
        // deleted (cos + 1) / 2 scoring these would have been 1, 0.9 and 0.5.
        const results = await semanticSearch({
          list: list(),
          fieldName: 'contentEmbedding',
          query: 'red',
          provider: searchProvider,
          minScore: 0.8,
        })

        expect(results.map((result) => result.item.content)).toEqual(['red', 'reddish'])
      })

      test('caps the result set at limit', async () => {
        await seedPalette()

        const results = await semanticSearch({
          list: list(),
          fieldName: 'contentEmbedding',
          query: 'red',
          provider: searchProvider,
          limit: 2,
        })

        expect(results.map((result) => result.item.content)).toEqual(['red', 'reddish'])
      })
    })

    describe('findSimilar', () => {
      test("ranks by the item's own embedding and leaves the item out", async () => {
        await seedPalette()

        const results = await findSimilar({
          list: list(),
          fieldName: 'contentEmbedding',
          itemId: await idOf('reddish'),
        })

        // From [0.8, 0.6, 0]: cos to red is 0.8, cos to blue is 0.6.
        expect(results.map((result) => result.item.content)).toEqual(['red', 'blue'])
        expect(results[0].score).toBeCloseTo(0.8, 5)
        expect(results[1].score).toBeCloseTo(0.6, 5)
      })

      test('keeps the item when excludeSelf is off', async () => {
        await seedPalette()

        const results = await findSimilar({
          list: list(),
          fieldName: 'contentEmbedding',
          itemId: await idOf('reddish'),
          excludeSelf: false,
        })

        expect(results.map((result) => result.item.content)).toEqual(['reddish', 'red', 'blue'])
        expect(results[0].score).toBeCloseTo(1, 5)
      })

      test('narrows by the where it was given', async () => {
        await seedPalette()
        await seed('Article', {
          content: 'red',
          published: false,
          contentEmbedding: VECTORS.red,
          contentEmbeddingMetadata: metadata,
        })

        const results = await findSimilar({
          list: list(),
          fieldName: 'contentEmbedding',
          itemId: await idOf('reddish'),
          where: { published: { equals: false } },
        })

        expect(results).toHaveLength(1)
        expect(results[0].score).toBeCloseTo(0.8, 5)
      })

      test('refuses an item with no embedding', async () => {
        await seed('Article', { content: 'red', published: true })

        await expect(
          findSimilar({
            list: list(),
            fieldName: 'contentEmbedding',
            itemId: await idOf('red'),
          }),
        ).rejects.toThrow('does not have an embedding in field "contentEmbedding"')
      })

      test('refuses an id no row this session can read carries', async () => {
        await expect(
          findSimilar({
            list: list(),
            fieldName: 'contentEmbedding',
            itemId: '00000000-0000-4000-8000-000000000000',
          }),
        ).rejects.toThrow('was not found, or this session may not read it')
      })
    })
  },
)
