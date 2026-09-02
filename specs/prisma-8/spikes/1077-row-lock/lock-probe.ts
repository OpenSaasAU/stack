// #1077 probe: how is ADR-0047's raw row-lock statement spelled at 8.0.0-rc.8, and what does the
// raw lane hand us for it — parameter codecs, identifier quoting, guardrails, transaction executor?
// Runs against a real Postgres (DATABASE_URL) for contention, and against PGlite for parse-only.
import postgres from '@prisma/orm-postgres/runtime'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import { lints, budgets } from '@prisma/orm-postgres/family-runtime'
import { param } from '@prisma/orm-postgres/relational-core/expression'
import { codecRefForStorageColumn } from '@prisma/orm-postgres/relational-core/codec-descriptor-registry'
import { quoteIdentifier, qualifyName } from '@prisma/orm-postgres/target/sql-utils'
import { PG_TEXT_ARRAY_CODEC_ID, PG_UUID_CODEC_ID } from '@prisma/orm-postgres/target/codec-ids'
import pg from 'pg'
import { contract, DDL } from './contract.ts'
import { startPglite } from './pglite-server.ts'

type Rendered = { sql: string; params: unknown[]; lane: string }
let rendered: Rendered[] = []
const recorder: SqlMiddleware = {
  name: 'recorder',
  familyId: 'sql',
  async beforeQuery(plan: any) {
    rendered.push({ sql: plan.sql, params: [...(plan.params ?? [])], lane: plan.meta?.lane })
  },
  async beforeExecute(plan: any) {
    rendered.push({ sql: plan.sql, params: [...(plan.params ?? [])], lane: plan.meta?.lane })
  },
}

const section = (t: string) => console.log(`\n== ${t} ==`)
const show = (label: string, v: unknown) => console.log(`${label.padEnd(44)} ${JSON.stringify(v)}`)
async function attempt(label: string, fn: () => Promise<unknown>) {
  rendered = []
  try {
    const v = await fn()
    show(label, v)
  } catch (e: any) {
    show(label, `THREW ${e?.constructor?.name}: ${String(e?.message).slice(0, 160)}`)
  }
  for (const r of rendered)
    console.log(`   sql[${r.lane}]: ${r.sql}   params=${JSON.stringify(r.params)}`)
}

async function runSuite(name: string, url: string, opts: { contention: boolean }) {
  section(`${name}: ${url.replace(/\/\/.*@/, '//…@')}`)
  const seed = new pg.Pool({ connectionString: url, max: 1 })
  await seed.query(DDL)
  await seed.query(`create table if not exists "Slot" (id uuid primary key, name text not null)`)
  await seed.query(`delete from "Post"; delete from "User"; delete from "Slot"`)
  await seed.query(`insert into "User" values ('u1','alice'),('u2','bob')`)
  await seed.query(
    `insert into "Post" values ('p1','t1',false,'u1'),('p2','t2',true,'u1'),('p3','t3',true,'u2')`,
  )
  await seed.query(
    `insert into "Slot" values ('018f0000-0000-7000-8000-000000000001','a'),('018f0000-0000-7000-8000-000000000002','b')`,
  )

  const db: any = postgres({ contract, url, middleware: [recorder], verifyMarker: false })

  // --- what the contract knows about the identity column, and what Prisma quotes for us
  section(`${name} / A. contract facts the engine would read`)
  const storage = contract.storage as any
  const postTable = storage.namespaces.public.entries.table.Post
  show('Post storage.primaryKey', postTable.primaryKey)
  show('Post id column codec (storage)', postTable.columns.id)
  show(
    'codecRefForStorageColumn(Post.id)',
    codecRefForStorageColumn(storage, 'public', 'Post', 'id'),
  )
  show('quoteIdentifier("Post")', quoteIdentifier('Post'))
  show('qualifyName("public","Post")', qualifyName('public', 'Post'))
  show('quoteIdentifier("we\\"ird")', quoteIdentifier('we"ird'))
  const pk = postTable.primaryKey.columns[0] as string
  const pkCodec = codecRefForStorageColumn(storage, 'public', 'Post', pk)!
  const table = `${quoteIdentifier('public')}.${quoteIdentifier('Post')}`
  const col = quoteIdentifier(pk)

  // --- spellings of the lock statement through the raw lane, executed via tx.query
  section(`${name} / B. spellings, run through tx.query(plan) inside db.transaction`)
  const keys = ['p2', 'p1']
  await attempt('B1 IN (param per key, contract codec)', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${param(keys[0], { codecId: pkCodec.codecId })}, ${param(keys[1], { codecId: pkCodec.codecId })}) ORDER BY "id" FOR UPDATE`
        .returnsRow({ id: pkCodec.codecId })
        .build()
      const rows = await tx.query(plan).toArray()
      return rows
    }),
  )
  await attempt('B2 = ANY(param text[])', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`SELECT "id" FROM "public"."Post" WHERE "id" = ANY(${param(keys, { codecId: PG_TEXT_ARRAY_CODEC_ID })}) ORDER BY "id" FOR UPDATE`
        .returnsRow({ id: pkCodec.codecId })
        .build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('B3 bare interpolation (inferred codec)', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}, ${'p2'}) ORDER BY "id" FOR UPDATE`
        .returnsRow({ id: pkCodec.codecId })
        .build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('B4 splice a db.sql select, append FOR UPDATE', () =>
    db.transaction(async (tx: any) => {
      let ops: string[] = []
      const inner = db.sql.public.Post.select('id')
        .where((f: any, fns: any) => {
          const cand = ['eq', 'equals', 'inList', 'in', 'isIn', 'inArray', 'and']
          ops = cand.filter((n) => typeof fns?.[n] === 'function')
          const name = ops[0]
          return fns[name](f.id, keys[0])
        })
        .orderBy('id')
      show('   field-proxy operators', ops)
      const plan = db.raw.sql`${inner} FOR UPDATE`.returnsRow({ id: pkCodec.codecId }).build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('B5 hand-written (SELECT …) FOR UPDATE parenthesised', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`(SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}, ${'p2'}) ORDER BY "id") FOR UPDATE`
        .returnsRow({ id: pkCodec.codecId })
        .build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('B6 engine spelling: tag called programmatically', () =>
    db.transaction(async (tx: any) => {
      // The engine's candidate: the raw tag invoked as a function over strings it assembled —
      // names quoted by Prisma's helper, one param per key bound with the identity column's own
      // codec, ORDER BY pk, LIMIT = key count, FOR UPDATE.
      const sorted = [...keys].sort()
      const strings = [
        `SELECT ${col} FROM ${table} WHERE ${col} IN (`,
        ...sorted.slice(1).map(() => ', '),
        `) ORDER BY ${col} LIMIT `,
        ' FOR UPDATE',
      ]
      const values = [...sorted.map((k) => param(k, { codecId: pkCodec.codecId })), sorted.length]
      const tsa = Object.assign(strings, { raw: strings }) as unknown as TemplateStringsArray
      const plan = db.raw
        .sql(tsa, ...values)
        .returnsRow({ [pk]: pkCodec.codecId })
        .build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('B7 uuid pk: bare string param vs uuid column', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`SELECT "id" FROM "public"."Slot" WHERE "id" IN (${'018f0000-0000-7000-8000-000000000001'}) ORDER BY "id" FOR UPDATE`
        .returnsRow({ id: PG_UUID_CODEC_ID })
        .build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('B8 uuid pk: param with PG_UUID codec', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`SELECT "id" FROM "public"."Slot" WHERE "id" IN (${param('018f0000-0000-7000-8000-000000000001', { codecId: PG_UUID_CODEC_ID })}) ORDER BY "id" FOR UPDATE`
        .returnsRow({ id: PG_UUID_CODEC_ID })
        .build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('B9 execute() instead of query() for the lock', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id" FOR UPDATE`
        .affectedCount()
        .build()
      return await tx.execute(plan)
    }),
  )
  await attempt('B10 advisory: pg_advisory_xact_lock(hashtext(key))', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw.sql`SELECT pg_advisory_xact_lock(hashtext(${'capacity:slot-1'}))`
        .affectedCount()
        .build()
      const r = await tx.execute(plan)
      const locks = db.raw
        .sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`
        .returnsRow({ n: 'pg/int4@1' })
        .build()
      return { execute: r, advisoryLocksHeld: await tx.query(locks).toArray() }
    }),
  )

  // --- does the statement lock? EXPLAIN + table-level lock mode
  section(`${name} / C. is it a lock: EXPLAIN and pg_locks`)
  await attempt('C1 EXPLAIN lock statement', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`EXPLAIN SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}, ${'p2'}) ORDER BY "id" FOR UPDATE`
        .returnsRow({ 'QUERY PLAN': 'pg/text@1' })
        .build()
      const rows = await tx.query(plan).toArray()
      return rows.map((r: any) => r['QUERY PLAN'].trim())
    }),
  )
  await attempt('C2 EXPLAIN parenthesised form', () =>
    db.transaction(async (tx: any) => {
      const plan = db.raw
        .sql`EXPLAIN (SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id") FOR UPDATE`
        .returnsRow({ 'QUERY PLAN': 'pg/text@1' })
        .build()
      const rows = await tx.query(plan).toArray()
      return rows.map((r: any) => r['QUERY PLAN'].trim())
    }),
  )
  await attempt('C3 pg_locks mode on Post inside the tx', () =>
    db.transaction(async (tx: any) => {
      const lock = db.raw
        .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id" FOR UPDATE`
        .returnsRow({ id: 'pg/text@1' })
        .build()
      await tx.query(lock).toArray()
      const modes = db.raw
        .sql`SELECT mode FROM pg_locks WHERE relation = '"public"."Post"'::regclass AND pid = pg_backend_pid() ORDER BY mode`
        .returnsRow({ mode: 'pg/text@1' })
        .build()
      return (await tx.query(modes).toArray()).map((r: any) => r.mode)
    }),
  )

  // --- guardrails: Prisma's opt-in lints middleware over the same statements
  section(`${name} / D. Prisma's opt-in lints() middleware against the lock statement`)
  const linted: any = postgres({
    contract,
    url,
    middleware: [recorder, lints()],
    verifyMarker: false,
  })
  await attempt('D1 lock without LIMIT under lints()', () =>
    linted.transaction(async (tx: any) => {
      const plan = linted.raw
        .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id" FOR UPDATE`
        .returnsRow({ id: 'pg/text@1' })
        .build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('D2 lock with LIMIT under lints()', () =>
    linted.transaction(async (tx: any) => {
      const plan = linted.raw
        .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id" LIMIT ${1} FOR UPDATE`
        .returnsRow({ id: 'pg/text@1' })
        .build()
      return await tx.query(plan).toArray()
    }),
  )
  await attempt('D2b lock without LIMIT under lints({noLimit:error})', async () => {
    const strict: any = postgres({
      contract,
      url,
      middleware: [recorder, lints({ severities: { noLimit: 'error' } })],
      verifyMarker: false,
    })
    try {
      return await strict.transaction(async (tx: any) => {
        const plan = strict.raw
          .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id" FOR UPDATE`
          .returnsRow({ id: 'pg/text@1' })
          .build()
        return await tx.query(plan).toArray()
      })
    } finally {
      await strict.close?.()
    }
  })
  await attempt('D2c lock without LIMIT under budgets()', async () => {
    const budgeted: any = postgres({
      contract,
      url,
      middleware: [recorder, budgets()],
      verifyMarker: false,
    })
    try {
      return await budgeted.transaction(async (tx: any) => {
        const plan = budgeted.raw
          .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id" FOR UPDATE`
          .returnsRow({ id: 'pg/text@1' })
          .build()
        return await tx.query(plan).toArray()
      })
    } finally {
      await budgeted.close?.()
    }
  })
  await attempt('D2d lock WITH LIMIT under budgets()', async () => {
    const budgeted: any = postgres({
      contract,
      url,
      middleware: [recorder, budgets()],
      verifyMarker: false,
    })
    try {
      return await budgeted.transaction(async (tx: any) => {
        const plan = budgeted.raw
          .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id" LIMIT ${1} FOR UPDATE`
          .returnsRow({ id: 'pg/text@1' })
          .build()
        return await tx.query(plan).toArray()
      })
    } finally {
      await budgeted.close?.()
    }
  })
  await attempt('D3 ORM read under lints() (control)', () =>
    linted.orm.public.Post.where({ id: 'p1' }).first(),
  )
  await linted.close?.()

  if (opts.contention) {
    section(`${name} / E. contention and the vanished row, second connection via pg`)
    const other = new pg.Client({ connectionString: url })
    await other.connect()
    await attempt('E1 lock p1 in tx A; B FOR UPDATE NOWAIT on p1 / p3', () =>
      db.transaction(async (tx: any) => {
        const lock = db.raw
          .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}) ORDER BY "id" FOR UPDATE`
          .returnsRow({ id: 'pg/text@1' })
          .build()
        await tx.query(lock).toArray()
        const b1 = await other
          .query(`select id from "Post" where id = 'p1' for update nowait`)
          .then(() => 'B acquired p1 (WRONG)')
          .catch((e: any) => `B on p1: ${e.code}`)
        await other.query('rollback').catch(() => {})
        const b3 = await other
          .query(`select id from "Post" where id = 'p3' for update nowait`)
          .then((r) => `B acquired p3: ${r.rowCount} row`)
          .catch((e: any) => `B on p3: ${e.code}`)
        return { b1, b3 }
      }),
    )
    await attempt('E2 after A commits, B acquires p1', () =>
      other
        .query(`select id from "Post" where id = 'p1' for update nowait`)
        .then((r) => `B acquired p1: ${r.rowCount} row`),
    )
    await attempt('E3 vanished row: read [p1,p2], delete p2 elsewhere, then lock', () =>
      db.transaction(async (tx: any) => {
        const read = await tx.orm.public.Post.where({ authorId: 'u1' }).select('id').all().toArray()
        const ids = read.map((r: any) => r.id).sort()
        await other.query(`delete from "Post" where id = 'p2'`)
        const lock = db.raw
          .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${ids[0]}, ${ids[1]}) ORDER BY "id" FOR UPDATE`
          .returnsRow({ id: 'pg/text@1' })
          .build()
        const locked = (await tx.query(lock).toArray()).map((r: any) => r.id)
        return { read: ids, locked }
      }),
    )
    await attempt('E4 SKIP LOCKED: B holds p1; A lock [p1,p3] SKIP LOCKED', async () => {
      await other.query('begin')
      await other.query(`select id from "Post" where id = 'p1' for update`)
      try {
        return await db.transaction(async (tx: any) => {
          const lock = db.raw
            .sql`SELECT "id" FROM "public"."Post" WHERE "id" IN (${'p1'}, ${'p3'}) ORDER BY "id" FOR UPDATE SKIP LOCKED`
            .returnsRow({ id: 'pg/text@1' })
            .build()
          return (await tx.query(lock).toArray()).map((r: any) => r.id)
        })
      } finally {
        await other.query('rollback')
      }
    })
    await other.end()
  }

  await db.close?.()
  await seed.end()
}

const real = process.env.DATABASE_URL
if (real) await runSuite('postgres14', real, { contention: true })
else console.log('DATABASE_URL unset — skipping the real-Postgres suite')

const s = await startPglite({ mode: 'tcp', maxConnections: 16, withVector: false })
try {
  await runSuite('pglite', s.url, { contention: false })
} finally {
  await s.stop()
}
