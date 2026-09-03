import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { createPostgresControlClient } from '@prisma/orm-postgres/control'
import postgres from '@prisma/orm-postgres/runtime'
import { buildPrismaContract, deriveContract, toEmittedContract } from '../src/contract/index.js'
import { blogConfig } from './fixtures/contract-configs.js'

/**
 * Boots a Prisma 8 runtime from the blog derivation against an in-process
 * PGlite reached over pglite-socket (ADR-0057): the control client applies
 * the schema and signs the marker, then one insert and one select round-trip
 * through the ORM. The socket server multiplexes every connection onto one
 * PGlite session, so `maxConnections` is raised above the ORM pool's needs
 * and the client is opened lazily on first use.
 */
describe('engine: the blog derivation boots a Prisma 8 runtime on PGlite', () => {
  const port = 5400 + Math.floor(Math.random() * 100)
  const url = `postgres://postgres@127.0.0.1:${port}/postgres`
  const migrationsDir = mkdtempSync(join(tmpdir(), 'opensaas-contract-'))
  let pglite: PGlite
  let server: PGLiteSocketServer

  beforeAll(async () => {
    pglite = new PGlite()
    await pglite.waitReady
    server = new PGLiteSocketServer({ db: pglite, host: '127.0.0.1', port, maxConnections: 10 })
    await server.start()
  }, 60_000)

  afterAll(async () => {
    await server?.stop()
    await pglite?.close()
    rmSync(migrationsDir, { recursive: true, force: true })
  })

  test('schema applies, the marker is signed, and a row round-trips', async () => {
    const contract = buildPrismaContract(deriveContract(blogConfig))
    const contractJson = toEmittedContract(contract)

    const control = createPostgresControlClient({ connection: url })
    const update = await control.dbUpdate({ contract: contractJson, mode: 'apply', migrationsDir })
    expect(update.ok).toBe(true)
    const init = await control.dbInit({ contract: contractJson, mode: 'apply', migrationsDir })
    expect(init.ok).toBe(true)
    await control.close()

    const tables = await pglite.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name not like 'prisma_%' order by 1`,
    )
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'Category',
      'Post',
      'Settings',
      'User',
    ])

    const uniques = await pglite.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = '"Post"'::regclass and contype in ('u', 'f') order by conname`,
    )
    expect(uniques.rows.map((row) => row.def)).toEqual(
      expect.arrayContaining([
        'UNIQUE (slug)',
        'FOREIGN KEY (author) REFERENCES "User"(id) ON DELETE SET NULL',
        'FOREIGN KEY (category) REFERENCES "Category"(id)',
      ]),
    )

    const db = postgres({ contract, url })
    try {
      const user = await db.orm.public.User.create({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'hashed',
      })
      expect(user).toMatchObject({ name: 'Ada', email: 'ada@example.com' })
      expect(typeof user.id).toBe('string')
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/)

      const post = await db.orm.public.Post.create({
        title: 'Hello',
        slug: 'hello',
        status: 'published',
        authorId: user.id,
      })
      expect(post).toMatchObject({ title: 'Hello', status: 'published', authorId: user.id })

      const found = await db.orm.public.User.where({ email: 'ada@example.com' })
        .include('posts')
        .first()
      expect(found).toMatchObject({ id: user.id, posts: [{ id: post.id, slug: 'hello' }] })
      expect(found?.createdAt).toBeDefined()
    } finally {
      await db.close()
    }
  }, 60_000)
})
