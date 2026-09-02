// FACT A (cont.): can Prisma's control client create the schema on PGlite instead of hand-written DDL?
import { createPostgresControlClient } from '@prisma/orm-postgres/control'
import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contract } from './contract.ts'
import { startPglite } from './pglite-server.ts'

const s = await startPglite({ mode: 'tcp', maxConnections: 10 })
const contractJson = JSON.parse(JSON.stringify(contract))
const migrationsDir = mkdtempSync(join(tmpdir(), 'mig-'))
const summarize = (r: any) =>
  JSON.stringify(r, (k, v) =>
    typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v,
  ).slice(0, 1500)

const control = createPostgresControlClient({ connection: s.url })
console.log('control client methods:', Object.keys(control).join(', '))
const t0 = performance.now()
for (const [label, fn] of [
  [
    'dbUpdate plan',
    () => control.dbUpdate({ contract: contractJson, mode: 'plan', migrationsDir }),
  ],
  [
    'dbUpdate apply',
    () => control.dbUpdate({ contract: contractJson, mode: 'apply', migrationsDir }),
  ],
  [
    'dbInit apply (after update)',
    () => control.dbInit({ contract: contractJson, mode: 'apply', migrationsDir }),
  ],
  [
    'schemaVerify strict',
    () => control.schemaVerify({ contract: contractJson, strict: true } as any),
  ],
  ['readMarker', () => control.readMarker()],
] as Array<[string, () => Promise<unknown>]>) {
  const t = performance.now()
  try {
    const r: any = await fn()
    console.log(
      `\n${label} (${(performance.now() - t).toFixed(0)}ms): ok=${r?.ok} ->`,
      summarize(r),
    )
  } catch (e: any) {
    console.log(
      `\n${label} FAILED (${(performance.now() - t).toFixed(0)}ms):`,
      e.code ?? '',
      String(e.message).slice(0, 300),
      e.why ? '| why: ' + e.why : '',
      e.cause ? '| cause: ' + String(e.cause.message).slice(0, 200) : '',
    )
  }
}
console.log(`\ncontrol total ${(performance.now() - t0).toFixed(0)}ms`)
await control.close()

console.log('\n-- tables in PGlite now --')
const pool = new pg.Pool({ connectionString: s.url, max: 1 })
console.log(
  (
    await pool.query(
      `select table_schema, table_name from information_schema.tables where table_schema not in ('pg_catalog','information_schema') order by 1,2`,
    )
  ).rows,
)
console.log(
  (
    await pool.query(
      `select column_name, data_type, is_nullable from information_schema.columns where table_name='Post' order by ordinal_position`,
    )
  ).rows,
)
console.log(
  'FKs:',
  (
    await pool.query(
      `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='"Post"'::regclass`,
    )
  ).rows,
)

console.log(
  '\n-- ORM against control-created schema (marker now present -> verifyMarker default passes) --',
)
const db: any = postgres({ contract, pg: pool })
await db.orm.public.User.create({ id: 'u1', name: 'a' })
console.log(
  await db.orm.public.Post.create({ id: 'p1', title: 't', published: true, authorId: 'u1' }),
)
await db.close()
await pool.end()
await s.stop()
