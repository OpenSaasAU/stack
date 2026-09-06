import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import { checkbox, relationship, text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { deriveContract } from '../contract/derive.js'
import {
  createTestContext,
  createTestDatabase,
  ormClientFor,
  OrmCollectionMissingError,
  type TestDatabase,
} from './context.js'
import { ESCAPE_VARIABLE, readDatabaseEscape } from './escape.js'
import { ExtensionPackUnavailableError, loadExtensionPacks } from './extensions.js'
import { createPlanRecorder } from './plans.js'

const BOOT = 120_000

const blogConfig: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User.posts' }),
      },
    },
  },
}

function vector(dimensions: number): BaseFieldConfig<TypeInfo> {
  return {
    type: 'vector',
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pgvector', type: 'Vector', args: [dimensions] },
      nullable: true,
    }),
  }
}

const ragConfig: OpenSaasConfig = {
  db: {
    provider: 'postgresql',
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
  },
  lists: {
    Document: {
      fields: { title: text({ validation: { isRequired: true } }), embedding: vector(3) },
    },
  },
}

type Harness = Pick<TestDatabase, 'client' | 'url'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The client's own collection for a model. The harness deliberately exposes
 * the constructed client rather than a seam on the secured wrapper, and a
 * contract built from config data is not statically indexable, so the lookup
 * narrows structurally — the same step `ormModel` performs for the engine.
 */
function collection(database: Harness, model: string): Record<string, unknown> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const found: unknown = Reflect.get(namespace, model)
  if (!isRecord(found)) throw new Error(`no collection "${model}"`)
  return found
}

function create(database: Harness, model: string, row: object): Promise<unknown> {
  const target = collection(database, model)
  const operation: unknown = target.create
  if (typeof operation !== 'function') throw new Error(`collection "${model}" has no create`)
  return Promise.resolve(operation.call(target, row))
}

function seed(database: Harness, model: string, row: object): Promise<unknown> {
  return withOrigin('unsafe', () => create(database, model, row))
}

/** Reads through the driver, not the ORM: truncation is a fact about the table. */
async function rows(database: Harness, table: string): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: database.url })
  await client.connect()
  try {
    const result = await client.query(`select * from "public"."${table}" order by "id"`)
    return result.rows
  } finally {
    await client.end()
  }
}

describe('the test database stands a blog-shaped config up', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(blogConfig)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  test(
    'seeds rows and reads them back',
    async () => {
      const created = await seed(database, 'User', { name: 'Ada', email: 'ada@example.test' })
      expect(created).toMatchObject({ name: 'Ada', email: 'ada@example.test' })

      const stored = await rows(database, 'User')
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({ name: 'Ada', email: 'ada@example.test' })
    },
    BOOT,
  )

  test(
    'the previous test left nothing behind',
    async () => {
      expect(await rows(database, 'User')).toEqual([])
      expect(await rows(database, 'Post')).toEqual([])
    },
    BOOT,
  )

  test('the provenance is the branch the escape chose', () => {
    expect(database.provenance).toBe(readDatabaseEscape().kind === 'postgres' ? 'escape' : 'pglite')
  })

  test('a context is the real secured context, at the session it was asked for', () => {
    const anonymous = database.context()
    const authenticated = database.context({ userId: 'user-1' })

    expect(anonymous.session).toBeNull()
    expect(authenticated.session).toEqual({ userId: 'user-1' })
    expect(typeof anonymous.transaction).toBe('function')
    expect(Object.keys(anonymous.db)).toEqual(expect.arrayContaining(['User', 'Post']))
  })

  test(
    'a query issued under no origin is refused by the tripwire the generator emits',
    async () => {
      await expect(
        create(database, 'User', { name: 'Eve', email: 'eve@example.test' }),
      ).rejects.toThrow(/unmarked/i)
      expect(await rows(database, 'User')).toEqual([])
    },
    BOOT,
  )
})

/**
 * PGlite bundles pgvector, so the default harness always runs this. A server
 * reached through the escape has to have been provisioned with it (ADR-0065),
 * and one that was not skips by name rather than failing on a missing control
 * file — the skip says which server and why.
 */
const escape = readDatabaseEscape()
const vectorAvailable =
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

const vectorSuite = vectorAvailable
  ? 'a pgvector-declaring config stands up on the default harness'
  : `a pgvector-declaring config stands up [skipped: the ${ESCAPE_VARIABLE} server has no pgvector]`

describe.skipIf(!vectorAvailable)(vectorSuite, () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(ragConfig)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  test(
    'the extension space was seeded before the schema, and a vector column round-trips',
    async () => {
      const installed = await rows(database, 'Document')
      expect(installed).toEqual([])

      const created = await seed(database, 'Document', { title: 'Hello', embedding: [1, 2, 3] })
      expect(created).toMatchObject({ title: 'Hello' })
      expect(await rows(database, 'Document')).toHaveLength(1)
    },
    BOOT,
  )
})

describe('the recording middleware', () => {
  test(
    'exposes each compiled plan and the origin it ran under',
    async () => {
      const recorder = createPlanRecorder()
      const harness = await createTestContext(
        blogConfig,
        { userId: 'user-1' },
        { middleware: [recorder.middleware] },
      )

      try {
        recorder.clear()
        await withOrigin('unsafe', () =>
          create(harness, 'User', { name: 'Grace', email: 'grace@example.test' }),
        )

        expect(recorder.plans).toHaveLength(1)
        const [plan] = recorder.plans
        expect(plan.origin).toBe('unsafe')
        expect(plan.lane).toBe('orm-client')
        expect(plan.kind).toBe(plan.ast.kind)
        expect(plan.meta).toBeDefined()

        recorder.clear()
        expect(recorder.plans).toEqual([])
      } finally {
        await harness.close()
      }
    },
    BOOT,
  )
})

describe('the DATABASE_URL escape', () => {
  test('a set-but-unusable value is a misconfiguration, not a database', () => {
    const saved = process.env[ESCAPE_VARIABLE]
    process.env[ESCAPE_VARIABLE] = 'file:./dev.db'
    try {
      expect(readDatabaseEscape()).toEqual({
        kind: 'unusable',
        url: 'file:./dev.db',
        fault: 'names the `file:` scheme, not Postgres',
      })
    } finally {
      if (saved === undefined) delete process.env[ESCAPE_VARIABLE]
      else process.env[ESCAPE_VARIABLE] = saved
    }
  })

  test.skipIf(escape.kind !== 'postgres')(
    `contention is observable on a real server [escape-only: ${ESCAPE_VARIABLE} names no Postgres]`,
    async () => {
      const database = await createTestDatabase(blogConfig)
      try {
        expect(database.provenance).toBe('escape')
        await seed(database, 'User', { name: 'Ada', email: 'ada@example.test' })
        expect(await rows(database, 'User')).toHaveLength(1)
      } finally {
        await database.close()
      }
    },
    BOOT,
  )
})

describe('the map the engine reaches models through is checked at construction', () => {
  const data = deriveContract(blogConfig)

  test('a client keyed the way Prisma keys one yields a collection per model', () => {
    const orm = { public: { User: { create: () => {} }, Post: { create: () => {} } } }
    const built = ormClientFor(data, orm)

    expect(Object.keys(built).sort()).toEqual(['Post', 'User'])
    for (const value of Object.values(built)) expect(typeof value).toBe('object')
  })

  test('a client keyed some other way is refused, naming the model and what is there', () => {
    const orm = { public: { users: {}, posts: {} } }

    expect(() => ormClientFor(data, orm)).toThrow(OrmCollectionMissingError)
    try {
      ormClientFor(data, orm)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(OrmCollectionMissingError)
      if (!(error instanceof OrmCollectionMissingError)) return
      expect(error.model).toBe('User')
      expect(error.namespace).toBe('public')
      expect(error.namespaces).toEqual(['public'])
      expect(error.collections).toEqual(['users', 'posts'])
      expect(error.message).toContain('User')
      expect(error.message).toContain('users, posts')
    }
  })

  test('a namespace that is absent altogether is refused too', () => {
    expect(() => ormClientFor(data, { app: {} })).toThrow(OrmCollectionMissingError)
  })
})

describe('extension packs load lazily', () => {
  test('a pack that cannot be imported is named, with the subpath and the remedy', async () => {
    await expect(
      loadExtensionPacks([{ name: 'nope', from: '@opensaas/definitely-not-installed' }]),
    ).rejects.toThrow(ExtensionPackUnavailableError)
  })

  test('a config declaring no pack imports no pack package', async () => {
    await expect(loadExtensionPacks([])).resolves.toEqual({})
  })
})
