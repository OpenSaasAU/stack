// FACT A (cont.): pgvector on PGlite + Vector(3) column via @prisma/orm-extension-pgvector.
import { defineContract, model, field } from '@prisma/orm-postgres/contract-builder'
import { textColumn } from '@prisma/orm-postgres/adapter/column-types'
import { vector } from '@prisma/orm-extension-pgvector/column-types'
import pgvectorPack from '@prisma/orm-extension-pgvector/pack'
import pgvectorRuntime from '@prisma/orm-extension-pgvector/runtime'
import pgvectorControl from '@prisma/orm-extension-pgvector/control'
import { createPostgresControlClient } from '@prisma/orm-postgres/control'
import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startPglite } from './pglite-server.ts'

const s = await startPglite({ mode: 'tcp', maxConnections: 10 })
const pool = new pg.Pool({ connectionString: s.url, max: 1 })
console.log('-- CREATE EXTENSION vector on PGlite --')
try {
  await pool.query('create extension if not exists vector')
  console.log(
    '   ok:',
    (await pool.query(`select extversion from pg_extension where extname='vector'`)).rows,
  )
} catch (e: any) {
  console.log('   FAILED:', e.message)
}
try {
  await pool
    .query(`select '[1,2,3]'::vector(3) <=> '[1,2,4]'::vector(3) as d`)
    .then((r) => console.log('   raw cosine distance:', r.rows[0].d))
} catch (e: any) {
  console.log('   raw vector op FAILED:', e.message)
}

console.log('\n-- contract with Vector(3) column --')
let contract: any
try {
  const Doc = model('Doc', {
    fields: {
      id: field.column(textColumn).id(),
      title: field.column(textColumn),
      embedding: field.column(vector(3)),
    },
  })
  contract = defineContract({ extensions: { pgvector: pgvectorPack }, models: { Doc } } as any)
  const json = JSON.parse(JSON.stringify(contract))
  console.log(
    '   ok; Doc.embedding storage column:',
    JSON.stringify(
      json.storage?.namespaces?.public?.entries?.table?.Doc?.columns?.embedding ??
        json.storage?.tables?.Doc?.columns?.embedding ??
        'UNKNOWN(path)',
    ),
  )
  console.log('   extensions in contract:', JSON.stringify(Object.keys(json.extensions ?? {})))
} catch (e: any) {
  console.log('   FAILED:', e.code ?? '', e.message, e.why ?? '')
  process.exit(1)
}

console.log('\n-- control client dbUpdate with pgvector control descriptor --')
const migrationsDir = mkdtempSync(join(tmpdir(), 'mig-'))
try {
  const control = createPostgresControlClient({ connection: s.url, extensions: [pgvectorControl] })
  const plan: any = await control.dbUpdate({
    contract: JSON.parse(JSON.stringify(contract)),
    mode: 'plan',
    migrationsDir,
  })
  console.log(
    '   plan ok=',
    plan.ok,
    plan.ok
      ? JSON.stringify(plan._value.plan.preview.statements.map((x: any) => x.text))
      : JSON.stringify(plan).slice(0, 600),
  )
  const apply: any = await control.dbUpdate({
    contract: JSON.parse(JSON.stringify(contract)),
    mode: 'apply',
    migrationsDir,
  })
  console.log(
    '   apply ok=',
    apply.ok,
    apply.ok ? apply._value.summary : JSON.stringify(apply).slice(0, 800),
  )
  await control.close()
} catch (e: any) {
  console.log(
    '   FAILED:',
    e.code ?? '',
    String(e.message).slice(0, 300),
    e.why ?? '',
    e.cause ? '| cause: ' + e.cause.message : '',
  )
}
console.log('\n-- control client dbUpdate WITHOUT pgvector control descriptor --')
try {
  const control2 = createPostgresControlClient({ connection: s.url })
  const plan: any = await control2.dbUpdate({
    contract: JSON.parse(JSON.stringify(contract)),
    mode: 'plan',
    migrationsDir,
  })
  console.log(
    '   plan ok=',
    plan.ok,
    plan.ok
      ? JSON.stringify(plan._value.plan.preview.statements.map((x: any) => x.text))
      : JSON.stringify(plan).slice(0, 400),
  )
  await control2.close()
} catch (e: any) {
  console.log('   FAILED:', e.code ?? '', String(e.message).slice(0, 200))
}
console.log('\n-- fallback: raw DDL for the vector column --')
await pool.query(
  `create table if not exists "Doc" (id text primary key, title text not null, embedding vector(3) not null)`,
)
console.log(
  '   Doc columns:',
  (
    await pool.query(
      `select column_name, udt_name from information_schema.columns where table_name='Doc' order by ordinal_position`,
    )
  ).rows,
)
console.log(
  '   extension present after dbUpdate:',
  (await pool.query(`select extname from pg_extension where extname='vector'`)).rows,
)

console.log('\n-- ORM: create + cosineDistance query --')
try {
  const db: any = postgres({ contract, pg: pool, extensions: [pgvectorRuntime] })
  const r = await db.orm.public.Doc.create({ id: 'd1', title: 'a', embedding: [1, 2, 3] })
  console.log('   create ->', JSON.stringify(r), ' embedding type:', r.embedding?.constructor?.name)
  await db.orm.public.Doc.create({ id: 'd2', title: 'b', embedding: [-1, -2, -3] })
  let methods: string[] = []
  db.orm.public.Doc.where((d: any) => {
    methods = Object.getOwnPropertyNames(Object.getPrototypeOf(d.embedding)).concat(
      Object.keys(d.embedding),
    )
    return d.id.eq('x')
  })
  console.log(
    '   field proxy methods on embedding:',
    methods
      .filter(
        (m) =>
          !m.startsWith('__') &&
          ![
            'constructor',
            'hasOwnProperty',
            'isPrototypeOf',
            'propertyIsEnumerable',
            'toString',
            'valueOf',
            'toLocaleString',
          ].includes(m),
      )
      .join(', '),
  )
  for (const attempt of [
    [
      'where(cosineDistance lt)',
      () =>
        db.orm.public.Doc.where((d: any) => d.embedding.cosineDistance([1, 2, 3]).lt(0.5)).all(),
    ],
    [
      'orderBy(cosineDistance)',
      () =>
        db.orm.public.Doc.orderBy((d: any) => d.embedding.cosineDistance([1, 2, 3]).asc()).all(),
    ],
    [
      'select + cosineSimilarity',
      () =>
        db.orm.public.Doc.select((d: any) => ({
          id: d.id,
          sim: d.embedding.cosineSimilarity([1, 2, 3]),
        })).all(),
    ],
    [
      'raw sql lane',
      () =>
        db.sql.query((f: any, fn: any) => {
          console.log(
            '    sql lane fns:',
            Object.keys(fn ?? {})
              .slice(0, 30)
              .join(','),
          )
          return null
        }),
    ],
  ] as Array<[string, () => Promise<unknown>]>) {
    try {
      console.log(`   ${attempt[0]} ->`, JSON.stringify(await attempt[1]()))
    } catch (e: any) {
      console.log(`   ${attempt[0]} FAILED:`, String(e.message).slice(0, 200))
    }
  }
  await db.close()
} catch (e: any) {
  console.log('   FAILED:', e.code ?? '', String(e.message).slice(0, 300), e.why ?? '')
}
await pool.end()
await s.stop()
