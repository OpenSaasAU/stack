// FACT A (cont.): unix-socket binding variants with root causes; concurrency vs PGLiteSocketServer maxConnections.
import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { contract, DDL } from './contract.ts'
import { startPglite } from './pglite-server.ts'

const seed = async (pool: pg.Pool) => {
  await pool.query(DDL)
  await pool.query(`insert into "User" values ('u1','alice'),('u2','bob') on conflict do nothing`)
  await pool.query(`insert into "Post" values ('p1','a1',true,'u1'),('p2','a2',false,'u1'),('p3','b1',true,'u2') on conflict do nothing`)
}
const causeChain = (e: any) => { const out: string[] = []; let c = e; while (c) { out.push(`${c.constructor?.name}: ${String(c.message).slice(0, 140)}`); c = c.cause }; return out.join('  <-  ') }

console.log('== unix socket binding variants (server maxConnections=1) ==')
{
  const s = await startPglite({ mode: 'unix' })
  const dir = s.socketPath!.replace(/\/\.s\.PGSQL\.5432$/, '')
  const seedPool = new pg.Pool({ host: dir, database: 'postgres', user: 'postgres', max: 1 }); await seed(seedPool); await seedPool.end()
  const variants: Array<[string, () => any]> = [
    ['url ?host=<dir>', () => postgres({ contract, url: s.url })],
    ['pg: Pool({host: dir, max: 1})', () => { const pool = new pg.Pool({ host: dir, database: 'postgres', user: 'postgres', max: 1 }); const c: any = postgres({ contract, pg: pool }); c.__pool = pool; return c }],
    ['pg: Pool({host: dir}) default max=10', () => { const pool = new pg.Pool({ host: dir, database: 'postgres', user: 'postgres' }); const c: any = postgres({ contract, pg: pool }); c.__pool = pool; return c }],
    ['pg: Client({host: dir})', () => postgres({ contract, pg: new pg.Client({ host: dir, database: 'postgres', user: 'postgres' }) })],
  ]
  for (const [label, mk] of variants) {
    const db: any = mk()
    try { const r = await db.orm.public.Post.all(); console.log(`  ${label.padEnd(40)} OK ${r.length} rows`) }
    catch (e: any) { console.log(`  ${label.padEnd(40)} FAIL: ${causeChain(e)}`) }
    try { await db.close(); await db.__pool?.end() } catch {}
  }
  await s.stop()
}
console.log('\n== same variants, server maxConnections=10 ==')
{
  const s = await startPglite({ mode: 'unix', maxConnections: 10 })
  const dir = s.socketPath!.replace(/\/\.s\.PGSQL\.5432$/, '')
  const seedPool = new pg.Pool({ host: dir, database: 'postgres', user: 'postgres', max: 1 }); await seed(seedPool); await seedPool.end()
  for (const [label, mk] of [
    ['url ?host=<dir>', () => postgres({ contract, url: s.url })],
    ['pg: Client({host: dir})', () => postgres({ contract, pg: new pg.Client({ host: dir, database: 'postgres', user: 'postgres' }) })],
  ] as Array<[string, () => any]>) {
    const db: any = mk()
    try { const r = await db.orm.public.Post.all(); console.log(`  ${label.padEnd(40)} OK ${r.length} rows`) }
    catch (e: any) { console.log(`  ${label.padEnd(40)} FAIL: ${causeChain(e)}`) }
    try { await db.close() } catch {}
  }
  await s.stop()
}

console.log('\n== why does the first query open >1 connection? count sockets during first .all() (tcp, maxConnections=10) ==')
{
  const s = await startPglite({ mode: 'tcp', maxConnections: 10 })
  const seedPool = new pg.Pool({ connectionString: s.url, max: 1 }); await seed(seedPool); await seedPool.end()
  const pool = new pg.Pool({ connectionString: s.url })
  const db: any = postgres({ contract, pg: pool })
  await db.orm.public.Post.all()
  console.log(`  after first .all(): pool.totalCount=${pool.totalCount} server active=${s.server.getStats().activeConnections}`)
  await db.orm.public.Post.all()
  console.log(`  after second .all(): pool.totalCount=${pool.totalCount}`)
  await db.close(); await pool.end(); await s.stop()
}

console.log('\n== concurrency: 5 concurrent .all() ==')
for (const [maxConnections, poolMax, label] of [[1, undefined, 'url (own pool, pg default max=10)'], [1, 1, 'pg: Pool max=1'], [5, undefined, 'url, server maxConnections=5'], [10, undefined, 'url, server maxConnections=10']] as const) {
  const s = await startPglite({ mode: 'tcp', maxConnections })
  const seedPool = new pg.Pool({ connectionString: s.url, max: 1 }); await seed(seedPool); await seedPool.end()
  const pool = poolMax ? new pg.Pool({ connectionString: s.url, max: poolMax }) : undefined
  const db: any = pool ? postgres({ contract, pg: pool }) : postgres({ contract, url: s.url })
  const t = performance.now()
  let outcome: unknown
  try {
    outcome = await Promise.race([
      Promise.all(Array.from({ length: 5 }, (_, i) => db.orm.public.Post.where({ authorId: i % 2 ? 'u1' : 'u2' }).all().then((r: any) => r.length))),
      new Promise((res) => setTimeout(() => res('TIMEOUT 10s'), 10_000)),
    ])
  } catch (e: any) { outcome = 'ERROR ' + causeChain(e) }
  console.log(`  server maxConnections=${maxConnections} ${label.padEnd(36)} -> ${JSON.stringify(outcome)} in ${(performance.now() - t).toFixed(0)}ms stats=${JSON.stringify(s.server.getStats())}`)
  try { await db.close(); await pool?.end() } catch {}
  await s.stop()
}
console.log('\n== 5 concurrent transactions (create + count), server maxConnections=10, url ==')
{
  const s = await startPglite({ mode: 'tcp', maxConnections: 10 })
  const seedPool = new pg.Pool({ connectionString: s.url, max: 1 }); await seed(seedPool); await seedPool.end()
  const db: any = postgres({ contract, url: s.url })
  const t = performance.now(); let outcome: unknown
  try {
    outcome = await Promise.race([
      Promise.all(Array.from({ length: 5 }, (_, i) => db.transaction(async (tx: any) => {
        await tx.orm.public.Post.create({ id: `t${i}`, title: 't', published: false, authorId: 'u1' })
        return (await tx.orm.public.Post.all()).length
      }))),
      new Promise((res) => setTimeout(() => res('TIMEOUT 15s'), 15_000)),
    ])
  } catch (e: any) { outcome = 'ERROR ' + causeChain(e) }
  console.log(`  -> ${JSON.stringify(outcome)} in ${(performance.now() - t).toFixed(0)}ms`)
  await db.close(); await s.stop()
}
console.log('\n== 5 concurrent transactions, pg: Pool max=1 (serialised by pool), server maxConnections=1 ==')
{
  const s = await startPglite({ mode: 'tcp', maxConnections: 1 })
  const pool = new pg.Pool({ connectionString: s.url, max: 1 }); await seed(pool)
  const db: any = postgres({ contract, pg: pool })
  const t = performance.now(); let outcome: unknown
  try {
    outcome = await Promise.race([
      Promise.all(Array.from({ length: 5 }, (_, i) => db.transaction(async (tx: any) => {
        await tx.orm.public.Post.create({ id: `t${i}`, title: 't', published: false, authorId: 'u1' })
        return (await tx.orm.public.Post.all()).length
      }))),
      new Promise((res) => setTimeout(() => res('TIMEOUT 15s'), 15_000)),
    ])
  } catch (e: any) { outcome = 'ERROR ' + causeChain(e) }
  console.log(`  -> ${JSON.stringify(outcome)} in ${(performance.now() - t).toFixed(0)}ms`)
  await db.close(); await pool.end(); await s.stop()
}
