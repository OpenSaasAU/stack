// What `embedding()` promises against a real schema: a native vector column
// with its metadata beside it, ranked by `nearest()`, assembled back into one
// value on the way out, and write-denied to application code (ADR-0045).
//
// Rows are seeded by writing their source text through `context.db`, so every
// vector under assertion is one the plugin's own generation hook produced.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import { config as defineConfig } from '@opensaas/stack-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'
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

/** Texts no field is written with directly — only a hook can produce them. */
const DERIVED: Record<string, number[]> = {
  'red hot': [0, 0, 1],
}

const fakeProvider: EmbeddingProvider = {
  type: 'fake',
  model: 'fake-3',
  dimensions: 3,
  embed: async (input: string) => {
    const vector = VECTORS[input] ?? DERIVED[input]
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
      access: { operation: { query: () => true, create: () => true, update: () => true } },
    },
    Derived: {
      fields: {
        title: text(),
        body: text(),
        content: text(),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
      },
      hooks: {
        // The plugin's own sudo write runs this pipeline too, carrying only the
        // embedding column, so an unguarded derivation would overwrite `content`
        // with the join of two undefineds on that second pass.
        resolveInput: ({ resolvedData }) =>
          typeof resolvedData.title === 'string'
            ? { ...resolvedData, content: [resolvedData.title, resolvedData.body].join(' ') }
            : resolvedData,
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

const metadata = {
  model: 'fake-3',
  provider: 'fake',
  dimensions: 3,
  generatedAt: '2026-01-01T00:00:00.000Z',
}

/** What the generation hook stamps beside a vector it produced itself. */
const generatedMetadata = { model: 'fake-3', provider: 'fake', dimensions: 3 }

let database: TestDatabase

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

/**
 * A row built off the secured surface, for the one shape the surface cannot
 * produce: metadata present with no vector beside it. Do not reach for this to
 * seed a vector — every other row here is written through `context.db` so the
 * vector under assertion is the plugin's own output.
 */
function seedOffSurface(model: string, row: object): Promise<void> {
  const target = collection(model)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => {
    await create.call(target, row)
  })
}

/** Writes the source text and lets the plugin's hook produce the vector. */
async function writeSource(content: string): Promise<string> {
  const created = await database.context(null).db.Article.create({ data: { content } })
  const id = created?.id
  if (typeof id !== 'string') throw new Error('the create returned no row')
  return id
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
      database = await createTestDatabase(await defineConfig(source))
    }, BOOT)

    afterAll(async () => {
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
    })

    test('the two columns read back as one stored embedding', async () => {
      await writeSource('red')

      const stored = await database.context(null).db.Article.where({}).first()

      expect(stored?.contentEmbedding).toMatchObject({
        vector: [1, 0, 0],
        metadata: generatedMetadata,
      })
      expect(stored).not.toHaveProperty('contentEmbeddingMetadata')
    })

    test('a row with no vector reads back as a null embedding', async () => {
      // Metadata present and the vector absent, so a null answer can only come
      // from the vector column. No write through `context.db` can produce that
      // row — the generation hook writes both columns or neither — so this one
      // is built off the surface on purpose.
      await seedOffSurface('Article', { content: 'red', contentEmbeddingMetadata: metadata })

      const stored = await database.context(null).db.Article.where({}).first()

      expect(stored?.contentEmbedding).toBeNull()
    })

    test('nearest ranks by the column the field declares', async () => {
      for (const content of Object.keys(VECTORS)) {
        await writeSource(content)
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

    test('the embedded text is the persisted source, not the caller’s input', async () => {
      // `content` is named nowhere in the write — a list-level resolveInput
      // derives it — so a hook reading `inputData` instead of the committed row
      // would find nothing to embed.
      await database.context(null).db.Derived.create({ data: { title: 'red', body: 'hot' } })

      const stored = await database.context(null).db.Derived.where({}).first()

      expect(stored?.content).toBe('red hot')
      expect(stored?.contentEmbedding).toMatchObject({
        vector: [0, 0, 1],
        metadata: generatedMetadata,
      })
    })

    test('a query vector of the wrong length is refused by the declared dimension', async () => {
      await expect(
        database.context(null).db.Article.nearest('contentEmbedding', [1, 0]),
      ).rejects.toThrow('is a 3-dimension column and the query vector has 2')
    })

    describe('write denial', () => {
      const denied = { contentEmbedding: { vector: [1, 0, 0], metadata } }

      test('an ordinary create naming the embedding throws', async () => {
        await expect(
          database.context(null).db.Article.create({ data: { content: 'red', ...denied } }),
        ).rejects.toThrow('Cannot create "contentEmbedding": field-level access denied.')
      })

      test('an ordinary update naming the embedding throws', async () => {
        const id = await writeSource('red')

        await expect(
          database.context(null).db.Article.update({ where: { id }, data: denied }),
        ).rejects.toThrow('Cannot update "contentEmbedding": field-level access denied.')
      })

      test('the write the throw refused never reaches the columns', async () => {
        // An empty source returns the generation hook early, so the column is
        // null for the whole test and the refused write is the only thing that
        // could have filled it.
        const id = await writeSource('')
        const before = await database.context(null).db.Article.where({}).first()
        expect(before?.contentEmbedding).toBeNull()

        await expect(
          database.context(null).db.Article.update({ where: { id }, data: denied }),
        ).rejects.toThrow('field-level access denied')

        const after = await database.context(null).db.Article.where({}).first()
        expect(after?.contentEmbedding).toBeNull()
      })

      test('a sudo write naming the embedding produces both columns, and they read back', async () => {
        await database
          .context(null)
          .sudo()
          .db.Article.create({ data: { content: '', ...denied } })

        const stored = await database.context(null).db.Article.where({}).first()
        expect(stored?.contentEmbedding).toEqual({ vector: [1, 0, 0], metadata })
      })

      /**
       * The plugin's own write, driven end to end: the symbol-keyed service a
       * live `getContext` built, over the real column, read back through the
       * secured surface.
       *
       * The source text is empty on purpose. The write commits, so the field's
       * own `afterTransaction` runs on the way out; over a non-empty source it
       * would regenerate the embedding and this assertion would be reading the
       * hook's output rather than the writer's. An empty source returns the
       * hook early, leaving the bytes under test the ones the writer put there.
       */
      test('the plugin\u2019s sudo write reaches the column', async () => {
        const id = await writeSource('')
        const seeded = await database.context(null).db.Article.where({}).first()
        expect(seeded?.contentEmbedding).toBeNull()

        const stored = { vector: [1, 0, 0], metadata }
        await embeddingWriterOf(database.context(null))('Article', id, 'contentEmbedding', stored)

        const after = await database.context(null).db.Article.where({}).first()
        expect(after?.contentEmbedding).toEqual(stored)
      })
    })
  },
)

/**
 * Where the write denial meets the two rules around it. `embedding()` is a
 * multi-column field, so its refusal comes from `splitMultiColumnFields`
 * (#568), which the Write Pipeline (#1152) reaches only after the operation
 * gate has had its say: a field-denied write throws and names the field, while
 * a caller the operation gate turned away gets the silent `null` and learns
 * nothing (ADR-0031). `allowManualWrites` is the third case — the same payload
 * on a field that opted out of the denial.
 */
const combined: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  plugins: [ragPlugin({ provider: { type: 'fake', dimensions: 3 } })],
  lists: {
    Article: {
      fields: {
        content: text(),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Locked: {
      fields: {
        content: text(),
        contentEmbedding: embedding({ sourceField: 'content', dimensions: 3 }),
      },
      access: { operation: { query: () => true, create: () => false } },
    },
    Manual: {
      fields: {
        content: text(),
        contentEmbedding: embedding({ dimensions: 3, allowManualWrites: true }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

describe.skipIf(!available)(
  available
    ? 'a denied embedding through the write pipeline'
    : `a denied embedding through the write pipeline [skipped: the ${ESCAPE_VARIABLE} server has no pgvector]`,
  () => {
    let db: TestDatabase
    const write = { content: 'red', contentEmbedding: { vector: [1, 0, 0], metadata } }

    beforeAll(async () => {
      db = await createTestDatabase(await defineConfig(combined))
    }, BOOT)

    afterAll(async () => {
      await db?.close()
    })

    beforeEach(async () => {
      await db.truncate()
    })

    test(
      'a create the operation gate admits throws, naming the denied field',
      async () => {
        await expect(db.context(null).db.Article.create({ data: write })).rejects.toThrow(
          'Cannot create "contentEmbedding": field-level access denied.',
        )

        expect(await db.context(null).db.Article.where({}).first()).toBeNull()
      },
      BOOT,
    )

    test(
      'the same payload from an operation-denied caller returns null, naming nothing',
      async () => {
        expect(await db.context(null).db.Locked.create({ data: write })).toBeNull()
        expect(await db.context(null).db.Locked.where({}).first()).toBeNull()
      },
      BOOT,
    )

    test(
      'the write the plugin owns still lands, so the denial is the field and not the list',
      async () => {
        const created = await db.context(null).db.Article.create({ data: { content: 'red' } })
        expect(created).toMatchObject({ content: 'red' })

        const stored = await db.context(null).db.Article.where({}).first()
        expect(stored?.contentEmbedding).toMatchObject({ vector: [1, 0, 0] })
      },
      BOOT,
    )

    test(
      'allowManualWrites lets the same payload reach the columns',
      async () => {
        const created = await db.context(null).db.Manual.create({ data: write })
        expect(created).toMatchObject({ content: 'red' })

        const stored = await db.context(null).db.Manual.where({}).first()
        expect(stored?.contentEmbedding).toEqual({ vector: [1, 0, 0], metadata })
      },
      BOOT,
    )
  },
)
