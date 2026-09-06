import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type {
  BaseFieldConfig,
  OpenSaasConfig,
  TypeInfo,
  VectorDistanceFunction,
} from '../config/types.js'
import type { Session } from '../access/types.js'
import { relationship, text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { createPlanRecorder } from '../testing/plans.js'
import { ESCAPE_VARIABLE, readDatabaseEscape } from '../testing/escape.js'

const BOOT = 120_000

/**
 * The vector field RAG's `embedding()` will be (#1128): a native `Vector(n)`
 * column that answers `getVectorColumn`. Declared here so this suite tests
 * core's terminal rather than the plugin's field builder.
 */
function embedding(
  dimensions: number,
  distanceFunction: VectorDistanceFunction,
  access?: BaseFieldConfig<TypeInfo>['access'],
): BaseFieldConfig<TypeInfo> {
  return {
    type: 'vector',
    access,
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pgvector', type: 'Vector', args: [dimensions] },
      nullable: true,
    }),
    getVectorColumn: (fieldName) => ({ column: fieldName, dimensions, distanceFunction }),
  }
}

const QUERY = [1, 0, 0]

/**
 * Three vectors whose ranking against {@link QUERY} differs by distance
 * function, so an assertion on the order is an assertion about the function
 * rather than about the seed.
 *
 * - cosine: unit, long, tilt
 * - l2: unit, tilt, long
 * - inner_product: long, unit, tilt
 */
const SEED: readonly { title: string; embedding: number[] }[] = [
  { title: 'unit', embedding: [1, 0, 0] },
  { title: 'long', embedding: [3, 0.1, 0] },
  { title: 'tilt', embedding: [0.6, 0.8, 0] },
]

const config: OpenSaasConfig = {
  db: {
    provider: 'postgresql',
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
  },
  lists: {
    Cosine: {
      fields: { title: text(), embedding: embedding(3, 'cosine') },
      access: { operation: { query: () => true } },
    },
    L2: {
      fields: { title: text(), embedding: embedding(3, 'l2') },
      access: { operation: { query: () => true } },
    },
    Inner: {
      fields: { title: text(), embedding: embedding(3, 'inner_product') },
      access: { operation: { query: () => true } },
    },
    // An Access Filter selective enough that ranking first and filtering after
    // would return short (spec #1123, story 32).
    Scoped: {
      fields: {
        title: text(),
        owner: text(),
        editorNotes: text({ access: { read: () => false } }),
        embedding: embedding(3, 'cosine'),
      },
      access: {
        operation: { query: ({ session }) => ({ owner: { equals: session?.userId ?? '' } }) },
      },
    },
    // A vector the session may not read: searching it measures its contents,
    // so the refusal must look like an undeclared key (ADR-0031, ADR-0045).
    Guarded: {
      fields: {
        title: text(),
        embedding: embedding(3, 'cosine', { read: () => false }),
      },
      access: { operation: { query: () => true } },
    },
    // `nearest()` is a terminal on the same composed value `include()` builds,
    // so a search that names a relation has to reach it through the same Field
    // Visibility and foreign-key repair `all()` does (#1148, #1234).
    Composed: {
      fields: {
        title: text(),
        writer: relationship({ ref: 'Writer' }),
        embedding: embedding(3, 'cosine'),
      },
      access: { operation: { query: () => true } },
    },
    Writer: {
      fields: { name: text(), secret: text({ access: { read: () => false } }) },
      access: {
        operation: { query: ({ session }) => ({ name: { equals: session?.userId ?? '' } }) },
      },
    },
    // Declares no rule, so `query` is denied by default.
    Locked: {
      fields: { title: text(), embedding: embedding(3, 'cosine') },
    },
  },
}

const recorder = createPlanRecorder()
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

/** Seed through the Unsafe origin: writes are spec 4's. */
function seed(model: string, row: object): Promise<void> {
  const target = collection(model)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => {
    await create.call(target, row)
  })
}

const anonymous: Session | null = null
const mine: Session = { userId: 'me' }

/** Every operation method the compiled AST names, anywhere in the node. */
function operations(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap((entry) => operations(entry))
  if (!isRecord(node)) return []
  const found = node.kind === 'operation' && typeof node.method === 'string' ? [node.method] : []
  return [...found, ...Object.values(node).flatMap((value) => operations(value))]
}

/** Every column the node compares or sorts by, in order. */
function columns(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap((entry) => columns(entry))
  if (!isRecord(node)) return []
  const found = node.kind === 'column-ref' && typeof node.column === 'string' ? [node.column] : []
  return [...found, ...Object.values(node).flatMap((value) => columns(value))]
}

function lastSelect(): Record<string, unknown> {
  const plan = recorder.plans.at(-1)
  if (plan === undefined) throw new Error('no plan was recorded')
  const ast: unknown = plan.ast
  if (!isRecord(ast)) throw new Error('the recorded plan carries no AST')
  return ast
}

function titles(matches: readonly { item: Record<string, unknown> }[]): unknown[] {
  return matches.map((match) => match.item.title)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  available ? 'nearest()' : `nearest() [skipped: the ${ESCAPE_VARIABLE} server has no pgvector]`,
  () => {
    beforeAll(async () => {
      database = await createTestDatabase(config, { middleware: [recorder.middleware] })
    }, BOOT)

    afterAll(async () => {
      await database?.close()
    })

    beforeEach(async () => {
      await database.truncate()
      recorder.clear()
    })

    describe('ranking', () => {
      test('cosine, L2 and inner product each rank by their own function', async () => {
        for (const model of ['Cosine', 'L2', 'Inner']) {
          for (const row of SEED) await seed(model, row)
        }
        const context = database.context(anonymous)

        expect(titles(await context.db.Cosine.nearest('embedding', QUERY))).toEqual([
          'unit',
          'long',
          'tilt',
        ])
        expect(titles(await context.db.L2.nearest('embedding', QUERY))).toEqual([
          'unit',
          'tilt',
          'long',
        ])
        expect(titles(await context.db.Inner.nearest('embedding', QUERY))).toEqual([
          'long',
          'unit',
          'tilt',
        ])
      })

      test('a row with no vector has no distance and is left out', async () => {
        for (const row of SEED) await seed('Cosine', row)
        await seed('Cosine', { title: 'unembedded', embedding: null })

        const matches = await database.context(anonymous).db.Cosine.nearest('embedding', QUERY)
        expect(titles(matches)).toEqual(['unit', 'long', 'tilt'])
      })

      test('the caller predicate narrows the set the ranking runs over', async () => {
        for (const row of SEED) await seed('Cosine', row)

        const matches = await database
          .context(anonymous)
          .db.Cosine.where({ title: { not: 'unit' } })
          .nearest('embedding', QUERY)
        expect(titles(matches)).toEqual(['long', 'tilt'])
      })
    })

    describe('minScore', () => {
      test('excludes rows below the bound, inside the query', async () => {
        for (const row of SEED) await seed('Cosine', row)

        const matches = await database
          .context(anonymous)
          .db.Cosine.nearest('embedding', QUERY, { minScore: 0.9 })
        expect(titles(matches)).toEqual(['unit', 'long'])

        // The bound is a predicate on the distance, not a filter over the
        // returned rows: the plan carries the operation in its `where`.
        const ast = lastSelect()
        expect(operations(ast.where)).toContain('nearest')
        expect(operations(ast.orderBy)).toContain('nearest')
      })

      test('excludes rows from an inner-product search, inside the query', async () => {
        // `<#>` is negative for aligned vectors, so the bound this lowers to
        // is negative too: scores are long 3, unit 1, tilt 0.6, and a bound of
        // 0.8 has to keep the first two and drop the third.
        for (const row of SEED) await seed('Inner', row)

        const matches = await database
          .context(anonymous)
          .db.Inner.nearest('embedding', QUERY, { minScore: 0.8 })
        expect(titles(matches)).toEqual(['long', 'unit'])
        expect(operations(lastSelect().where)).toContain('nearest')

        const tighter = await database
          .context(anonymous)
          .db.Inner.nearest('embedding', QUERY, { minScore: 2 })
        expect(titles(tighter)).toEqual(['long'])
      })

      test('a cosine score at or below minus one bounds nothing', async () => {
        // Cosine distance is bounded on [0, 2], so a score of -1 admits every
        // row and the predicate is left out — the rule l2 already follows.
        for (const row of SEED) await seed('Cosine', row)

        const matches = await database
          .context(anonymous)
          .db.Cosine.nearest('embedding', QUERY, { minScore: -1 })
        expect(titles(matches)).toEqual(['unit', 'long', 'tilt'])
        expect(operations(lastSelect().where)).not.toContain('nearest')
      })

      test('an l2 score at or below zero bounds nothing', async () => {
        for (const row of SEED) await seed('L2', row)

        const matches = await database
          .context(anonymous)
          .db.L2.nearest('embedding', QUERY, { minScore: 0 })
        expect(titles(matches)).toEqual(['unit', 'tilt', 'long'])
        expect(operations(lastSelect().where)).not.toContain('nearest')
      })
    })

    describe('Access Filter', () => {
      test("a scoped session's top-K is computed over its visible rows", async () => {
        // The three nearest rows belong to somebody else. Ranking first and
        // filtering after would return nothing at limit 2.
        await seed('Scoped', { title: 'theirs-1', owner: 'other', embedding: [1, 0, 0] })
        await seed('Scoped', { title: 'theirs-2', owner: 'other', embedding: [0.99, 0.1, 0] })
        await seed('Scoped', { title: 'theirs-3', owner: 'other', embedding: [0.98, 0.15, 0] })
        await seed('Scoped', { title: 'mine-near', owner: 'me', embedding: [0.5, 0.87, 0] })
        await seed('Scoped', { title: 'mine-far', owner: 'me', embedding: [0, 1, 0] })

        const matches = await database
          .context(mine)
          .db.Scoped.nearest('embedding', QUERY, { limit: 2 })
        expect(titles(matches)).toEqual(['mine-near', 'mine-far'])

        const ast = lastSelect()
        expect(columns(ast.where)).toContain('owner')
        expect(ast.limit).toBe(2)
      })
    })

    describe('Field Visibility', () => {
      test('the item is the row this session may see', async () => {
        await seed('Scoped', {
          title: 'mine',
          owner: 'me',
          editorNotes: 'private',
          embedding: [1, 0, 0],
        })

        const [match] = await database.context(mine).db.Scoped.nearest('embedding', QUERY)
        expect(match.item.title).toBe('mine')
        expect(match.item).not.toHaveProperty('editorNotes')
      })

      test('an included relation is scoped, stripped and its foreign key repaired', async () => {
        const mineId = '00000000-0000-7000-8000-000000000001'
        const theirsId = '00000000-0000-7000-8000-000000000002'
        await seed('Writer', { id: mineId, name: 'me', secret: 'private' })
        await seed('Writer', { id: theirsId, name: 'other', secret: 'private' })
        await seed('Composed', { title: 'mine', writerId: mineId, embedding: [1, 0, 0] })
        await seed('Composed', { title: 'theirs', writerId: theirsId, embedding: [0.99, 0.1, 0] })

        const matches = await database
          .context(mine)
          .db.Composed.include('writer')
          .nearest('embedding', QUERY)
        expect(titles(matches)).toEqual(['mine', 'theirs'])

        const [own, other] = matches
        expect(own.item.writer).toMatchObject({ name: 'me' })
        expect(own.item.writer).not.toHaveProperty('secret')
        expect(own.item.writerId).toBe(mineId)

        // The Access Filter scoped this writer away, so the relation is `null`
        // and the foreign key must not survive as the invisible row's id.
        expect(other.item.writer).toBeNull()
        expect(other.item.writerId).toBeNull()
      })
    })

    describe('the return shape', () => {
      test('is { item, score } and the raw distance is not exposed', async () => {
        await seed('Cosine', SEED[2])

        const [match] = await database.context(anonymous).db.Cosine.nearest('embedding', QUERY)
        expect(Object.keys(match).sort()).toEqual(['item', 'score'])
        // cosine similarity of [0.6, 0.8, 0] against [1, 0, 0]
        expect(match.score).toBeCloseTo(0.6, 5)
        expect(match.item).not.toHaveProperty('distance')
        expect(match.item).not.toHaveProperty('score')
      })

      test('an inner-product score is the un-negated similarity', async () => {
        await seed('Inner', SEED[1])

        const [match] = await database.context(anonymous).db.Inner.nearest('embedding', QUERY)
        expect(match.score).toBeCloseTo(3, 5)
      })
    })

    describe('Silent failure', () => {
      test('a denied read returns [] rather than refusing', async () => {
        await seed('Locked', { title: 'nobody may read this', embedding: [1, 0, 0] })

        expect(await database.context(anonymous).db.Locked.nearest('embedding', QUERY)).toEqual([])
      })

      test('the denial short-circuits before the field is resolved', async () => {
        expect(await database.context(anonymous).db.Locked.nearest('nope', QUERY)).toEqual([])
      })
    })

    describe('refusals', () => {
      test('a field the session may not read is refused as an undeclared one', async () => {
        const context = database.context(anonymous)

        const denied = await context.db.Guarded.nearest('embedding', QUERY).catch(
          (error: unknown) => error,
        )
        const absent = await context.db.Guarded.nearest('nope', QUERY).catch(
          (error: unknown) => error,
        )

        expect(denied).toBeInstanceOf(ValidationError)
        expect(absent).toBeInstanceOf(ValidationError)
        // Identical but for the key each was given, which is the caller's own
        // word: nothing in the refusal says which of the two reasons it is.
        expect(message(denied)).toBe(message(absent).replaceAll('nope', 'embedding'))
      })

      test('a field with no vector column is refused', async () => {
        await expect(database.context(anonymous).db.Cosine.nearest('title', QUERY)).rejects.toThrow(
          /is not a vector column/,
        )
      })

      test('a query vector of the wrong dimension is refused', async () => {
        await expect(
          database.context(anonymous).db.Cosine.nearest('embedding', [1, 0]),
        ).rejects.toThrow(/3-dimension column and the query vector has 2/)
      })

      test('a composed distinct or cursor is refused rather than dropped', async () => {
        const context = database.context(anonymous)

        await expect(
          context.db.Cosine.distinct('title').nearest('embedding', QUERY),
        ).rejects.toThrow(/composed distinct or cursor/)
        await expect(
          context.db.Cosine.orderBy({ title: 'asc' })
            .cursor({ title: 'unit' })
            .nearest('embedding', QUERY),
        ).rejects.toThrow(/composed distinct or cursor/)
      })

      test('a denied read still answers [] rather than that refusal', async () => {
        expect(
          await database
            .context(anonymous)
            .db.Locked.orderBy({ title: 'asc' })
            .cursor({ title: 'unit' })
            .nearest('embedding', QUERY),
        ).toEqual([])
      })

      test('a limit that is not a positive whole number is refused', async () => {
        await expect(
          database.context(anonymous).db.Cosine.nearest('embedding', QUERY, { limit: 0 }),
        ).rejects.toThrow(/limit takes a positive whole number/)
      })
    })
  },
)
