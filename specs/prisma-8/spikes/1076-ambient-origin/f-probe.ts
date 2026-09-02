import { AsyncLocalStorage } from 'node:async_hooks'
import postgres from '@prisma/orm-postgres/runtime'
import * as builder from '@prisma/orm-postgres/builder'
import pg from 'pg'
import { contract, DDL } from './contract.ts'
import { startPglite } from './pglite-server.ts'
const store = new AsyncLocalStorage<{ origin: string }>()
let seen: string[] = []
let throwMode = false
const tripwire: any = {
  name: 't',
  familyId: 'sql',
  async beforeCompile(d: any) {
    const o = store.getStore()
    seen.push(`${d.ast.kind}:${o?.origin ?? '-'}`)
    if (throwMode && !o) throw new Error('UNSTAMPED')
    return undefined
  },
}
const s = await startPglite({ mode: 'tcp', maxConnections: 10 })
const pool = new pg.Pool({ connectionString: s.url, max: 1 })
await pool.query(DDL)
await pool.query(`insert into "User" values ('u1','a') on conflict do nothing`)
await pool.query(`insert into "Post" values ('p1','t',false,'u1') on conflict do nothing`)
await pool.end()
const db: any = postgres({ contract, url: s.url, middleware: [tripwire], verifyMarker: false })
console.log('builder exports:', Object.keys(builder).join(','))
const fns: any = (builder as any).fns ?? (builder as any).default?.fns
const eq = fns?.eq ?? (builder as any).eq
const mk = (sql: any, params: any) =>
  sql.public.Post.select('id')
    .where((c: any, f: any) => f.eq(c.id, params.id))
    .build()
try {
  seen = []
  const prepared: any = await store.run({ origin: 'engine' }, () =>
    db.prepare({ id: 'pg/text@1' }, mk),
  )
  console.log('F1 prepare():', seen.join(' '))
  const names = new Set<string>()
  let o = prepared
  while (o && o !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(o)) names.add(k)
    o = Object.getPrototypeOf(o)
  }
  console.log('   prepared members:', [...names].filter((n) => n !== 'constructor').join(','))
  const exec = async () => {
    let r: any
    try {
      r = prepared.query(db.runtime(), { id: 'p1' })
    } catch (e: any) {
      console.log('   query(runtime, params) threw', e.message.slice(0, 80))
      r = prepared.query({ id: 'p1' }, db.runtime())
    }
    const rows = []
    for await (const x of r) rows.push(x)
    return rows
  }
  seen = []
  console.log(
    'F2 execute outside run: rows',
    JSON.stringify(await exec()),
    ' beforeCompile calls:',
    seen.length,
    seen.join(' '),
  )
  seen = []
  throwMode = true
  try {
    await exec()
    console.log(
      'F3 execute outside run, tripwire throwing: NOT refused; beforeCompile calls:',
      seen.length,
    )
  } catch (e: any) {
    console.log('F3 refused:', e.message)
  } finally {
    throwMode = false
  }
  seen = []
  throwMode = true
  try {
    await db.prepare({ id: 'pg/text@1' }, mk)
    console.log('F4 prepare outside run, tripwire throwing: NOT refused', seen.join(' '))
  } catch (e: any) {
    console.log('F4 prepare outside run, tripwire throwing: refused ->', e.message.slice(0, 60))
  } finally {
    throwMode = false
  }
} catch (e: any) {
  console.log('prepare probe failed:', e.constructor?.name, e.message.slice(0, 200))
}
await db.close()
await s.stop()
process.exit(0)
