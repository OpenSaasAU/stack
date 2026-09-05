import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { createPostgresControlClient } from '@prisma/orm-postgres/control'
import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import {
  buildPrismaContract,
  deriveContract,
  toEmittedContract,
  type PrismaContract,
} from '../src/contract/index.js'
import { deriveConstraintMap } from '../src/contract/dependencies.js'
import { authConfig, blogConfig, oneToOneConfig } from './fixtures/contract-configs.js'

/**
 * An in-process PGlite reached over pglite-socket (ADR-0057). The socket
 * server multiplexes every connection onto one PGlite session, so the
 * runtime client below is bound to a single-connection pool and
 * `maxConnections` only buys headroom for the control client alongside it.
 */
type Database = {
  pglite: PGlite
  server: PGLiteSocketServer
  url: string
  migrationsDir: string
}

async function bootDatabase(): Promise<Database> {
  const pglite = new PGlite()
  await pglite.waitReady
  const server = new PGLiteSocketServer({
    db: pglite,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 10,
  })
  await server.start()
  return {
    pglite,
    server,
    url: `postgres://postgres@${server.getServerConn()}/postgres`,
    migrationsDir: mkdtempSync(join(tmpdir(), 'opensaas-contract-')),
  }
}

async function shutdownDatabase(db: Database | undefined): Promise<void> {
  if (!db) return
  await db.server.stop()
  await db.pglite.close()
  rmSync(db.migrationsDir, { recursive: true, force: true })
}

/** Applies the contract with `dbInit` and checks a follow-up `dbUpdate` plan is empty. */
async function applyContract(db: Database, contract: PrismaContract): Promise<void> {
  const contractJson = toEmittedContract(contract)
  const control = createPostgresControlClient({ connection: db.url })
  try {
    const init = await control.dbInit({
      contract: contractJson,
      mode: 'apply',
      migrationsDir: db.migrationsDir,
    })
    expect(init.ok).toBe(true)
    const plan = await control.dbUpdate({
      contract: contractJson,
      mode: 'plan',
      migrationsDir: db.migrationsDir,
    })
    expect(plan.assertOk().plan.operations).toEqual([])
  } finally {
    await control.close()
  }
}

function runtime(db: Database, contract: PrismaContract) {
  return postgres({ contract, pg: new pg.Pool({ connectionString: db.url, max: 1 }) })
}

describe('engine: the blog derivation boots a Prisma 8 runtime on PGlite', () => {
  let db: Database

  beforeAll(async () => {
    db = await bootDatabase()
  }, 60_000)

  afterAll(async () => {
    await shutdownDatabase(db)
  })

  test('schema applies, the marker is signed, and a row round-trips', async () => {
    const contract = buildPrismaContract(deriveContract(blogConfig))
    await applyContract(db, contract)

    const tables = await db.pglite.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name not like 'prisma_%' order by 1`,
    )
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'Category',
      'Post',
      'Settings',
      'User',
    ])

    const constraints = await db.pglite.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = '"Post"'::regclass and contype in ('u', 'f') order by conname`,
    )
    expect(constraints.rows.map((row) => row.def)).toEqual(
      expect.arrayContaining([
        'UNIQUE (slug)',
        'FOREIGN KEY (author) REFERENCES "User"(id) ON DELETE SET NULL',
        'FOREIGN KEY (category) REFERENCES "Category"(id)',
      ]),
    )
    const indexes = await db.pglite.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'Post' order by 1`,
    )
    expect(indexes.rows.map((row) => row.indexname)).toContain('post_author_status')

    const orm = runtime(db, contract)
    try {
      const user = await orm.orm.public.User.create({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'hashed',
      })
      expect(user).toMatchObject({ name: 'Ada', email: 'ada@example.com' })
      expect(typeof user.id).toBe('string')
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/)

      const post = await orm.orm.public.Post.create({
        title: 'Hello',
        slug: 'hello',
        status: 'published',
        authorId: user.id,
      })
      expect(post).toMatchObject({ title: 'Hello', status: 'published', authorId: user.id })

      const found = await orm.orm.public.User.where({ email: 'ada@example.com' })
        .include('posts')
        .first()
      expect(found).toMatchObject({ id: user.id, posts: [{ id: post.id, slug: 'hello' }] })
      expect(found?.createdAt).toBeDefined()
    } finally {
      await orm.close()
    }
  }, 60_000)
})

describe('engine: the one-to-one derivation applies SERIAL ids and the owning unique', () => {
  let db: Database

  beforeAll(async () => {
    db = await bootDatabase()
  }, 60_000)

  afterAll(async () => {
    await shutdownDatabase(db)
  })

  test('int autoincrement is a sequence default; the owning column is unique and cascades', async () => {
    const contract = buildPrismaContract(deriveContract(oneToOneConfig))
    await applyContract(db, contract)

    const idColumn = await db.pglite.query<{ data_type: string; column_default: string }>(
      `select data_type, column_default from information_schema.columns where table_name = 'User' and column_name = 'id'`,
    )
    expect(idColumn.rows[0]).toEqual({
      data_type: 'integer',
      column_default: `nextval('"User_id_seq"'::regclass)`,
    })

    const constraints = await db.pglite.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = '"Profile"'::regclass and contype in ('u', 'f') order by 1`,
    )
    expect(constraints.rows.map((row) => row.def)).toEqual([
      'FOREIGN KEY ("user") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE',
      'UNIQUE ("user")',
    ])

    const orm = runtime(db, contract)
    try {
      const user = await orm.orm.public.User.create({ email: 'ada@example.com' })
      expect(user.id).toBe(1)
      const profile = await orm.orm.public.Profile.create({ bio: 'hi', userId: user.id })
      expect(profile).toMatchObject({ bio: 'hi', userId: 1 })
      expect(profile.id).toMatch(/^[a-z0-9]{24}$/)

      const found = await orm.orm.public.User.where({ id: user.id }).include('profile').first()
      expect(found).toMatchObject({ id: 1, profile: { id: profile.id, bio: 'hi' } })

      await expect(
        orm.orm.public.Profile.create({ bio: 'second', userId: user.id }),
      ).rejects.toThrow()
    } finally {
      await orm.close()
    }
  }, 60_000)
})

/**
 * Every name in the emitted constraint map is a real unique constraint in
 * PostgreSQL, and every unique constraint PostgreSQL created is in the map.
 * Nothing else pins the derived names — they are what PostgreSQL builds from
 * the physical table and columns, and a violation reaches the runtime under
 * exactly that name (ADR-0042).
 */
describe('engine: the constraint map names the constraints PostgreSQL actually created', () => {
  let db: Database

  beforeAll(async () => {
    db = await bootDatabase()
  }, 60_000)

  afterAll(async () => {
    await shutdownDatabase(db)
  })

  test.each([
    ['blog', blogConfig],
    ['auth', authConfig],
    ['one-to-one', oneToOneConfig],
  ])(
    '%s',
    async (_name, config) => {
      const data = deriveContract(config)
      await applyContract(db, buildPrismaContract(data))

      const rows = await db.pglite.query<{ conname: string }>(
        `select conname from pg_constraint
       where contype in ('u', 'p')
         and connamespace = 'public'::regnamespace
         and conrelid::regclass::text not like 'prisma_%'
       order by conname`,
      )

      const emitted = Object.keys(deriveConstraintMap(config, data)).sort()
      expect(rows.rows.map((row) => row.conname)).toEqual(emitted)

      await db.pglite.exec('drop schema public cascade; create schema public;')
      await db.pglite.exec('drop schema if exists prisma_contract cascade;')
    },
    60_000,
  )
})
