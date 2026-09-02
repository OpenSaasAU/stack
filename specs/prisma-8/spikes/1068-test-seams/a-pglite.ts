// FACT A: PGlite in-process as the Prisma 8 test DB. Startup, latency, unix vs tcp, two instances, concurrency.
import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { contract, DDL } from './contract.ts'
import { startPglite } from './pglite-server.ts'

const seed = async (pool: pg.Pool) => {
  await pool.query(DDL)
  await pool.query(`insert into "User" values ('u1','alice'),('u2','bob') on conflict do nothing`)
  await pool.query(`insert into "Post" values ('p1','a1',true,'u1'),('p2','a2',false,'u1'),('p3','b1',true,'u2') on conflict do nothing`)
}

console.log('== startup: PGlite(+pgvector ext) + PGLiteSocketServer, 3 runs each mode ==')
for (const mode of ['unix', 'tcp'] as const) {
  for (let i = 0; i < 3; i++) {
    const s = await startPglite({ mode })
    console.log(`  ${mode} run ${i + 1}: pglite=${s.ms.pglite.toFixed(0)}ms socket=${s.ms.socket.toFixed(1)}ms total=${s.ms.total.toFixed(0)}ms`)
    await s.stop()
  }
}
{
  const t = performance.now(); const s = await startPglite({ mode: 'unix', withVector: false })
  console.log(`  unix (no pgvector ext): total=${s.ms.total.toFixed(0)}ms`); await s.stop()
}

console.log('\n== unix socket: postgres({ url }) vs pg: new Pool({ host: dir }) ==')
{
  const s = await startPglite({ mode: 'unix' })
  const dir = s.socketPath!.replace(/\/\.s\.PGSQL\.5432$/, '')
  // (a) url with ?host=<dir>  (node-postgres pg-connection-string maps host= to unix dir)
  try {
    const db: any = postgres({ contract, url: s.url })
    const pool = new pg.Pool({ host: dir, database: 'postgres', user: 'postgres', max: 1 }); await seed(pool); await pool.end()
    console.log('  url=?host=<dir> ->', (await db.orm.public.Post.all()).length, 'rows OK')
    await db.close()
  } catch (e: any) { console.log('  url=?host=<dir> FAILED:', e.message) }
  // (b) url with host as socket dir path in authority (postgres:///postgres?host=...) is same; try plain path in host:
  try {
    const db: any = postgres({ contract, url: `postgres://postgres@${encodeURIComponent(dir)}/postgres` })
    console.log('  url with encoded dir as host ->', (await db.orm.public.Post.all()).length, 'rows OK')
    await db.close()
  } catch (e: any) { console.log('  url with encoded dir as host FAILED:', String(e.message).slice(0, 120)) }
  // (c) pg: Pool({ host: dir })
  try {
    const pool = new pg.Pool({ host: dir, database: 'postgres', user: 'postgres', max: 1 })
    const db: any = postgres({ contract, pg: pool })
    console.log('  pg: Pool({host: dir}) ->', (await db.orm.public.Post.all()).length, 'rows OK')
    await db.close(); await pool.end()
  } catch (e: any) { console.log('  pg: Pool({host: dir}) FAILED:', e.message) }
  // (d) pg: Client({ host: dir })
  try {
    const client = new pg.Client({ host: dir, database: 'postgres', user: 'postgres' })
    const db: any = postgres({ contract, pg: client })
    console.log('  pg: Client({host: dir}) ->', (await db.orm.public.Post.all()).length, 'rows OK')
    await db.close()
  } catch (e: any) { console.log('  pg: Client({host: dir}) FAILED:', e.message) }
  await s.stop()
}

console.log('\n== per-query latency (.where().all(), shared client, warm) ==')
for (const mode of ['unix', 'tcp'] as const) {
  const s = await startPglite({ mode })
  const pool = new pg.Pool({ connectionString: s.url, max: 1 }); await seed(pool)
  const db: any = postgres({ contract, pg: pool })
  const q = () => db.orm.public.Post.where({ authorId: 'u1' }).all()
  await q(); await q()
  const N = 300; const t = process.hrtime.bigint()
  for (let i = 0; i < N; i++) await q()
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / N
  const N2 = 300; const t2 = process.hrtime.bigint()
  for (let i = 0; i < N2; i++) await pool.query('select * from "Post" where "authorId"=$1', ['u1'])
  const ms2 = Number(process.hrtime.bigint() - t2) / 1e6 / N2
  console.log(`  ${mode}: orm .where().all() = ${ms.toFixed(3)} ms/query   raw pg.query = ${ms2.toFixed(3)} ms/query`)
  await db.close(); await pool.end(); await s.stop()
}

console.log('\n== two PGlite instances in one process ==')
{
  const a = await startPglite({ mode: 'unix' }); const b = await startPglite({ mode: 'unix' })
  const pa = new pg.Pool({ connectionString: a.url, max: 1 }); const pb = new pg.Pool({ connectionString: b.url, max: 1 })
  await seed(pa); await pb.query(DDL); await pb.query(`insert into "User" values ('zz','zed')`)
  const da: any = postgres({ contract, pg: pa }); const dbb: any = postgres({ contract, pg: pb })
  const [ra, rb] = await Promise.all([da.orm.public.User.all(), dbb.orm.public.User.all()])
  console.log('  A users:', ra.map((u: any) => u.id), ' B users:', rb.map((u: any) => u.id), ' isolated:', ra.length === 2 && rb.length === 1)
  await da.close(); await dbb.close(); await pa.end(); await pb.end(); await a.stop(); await b.stop()
}

console.log('\n== concurrency: 5 concurrent .all() through postgres({ url }) (pg default pool max=10) ==')
for (const maxConnections of [1, 5]) {
  const s = await startPglite({ mode: 'tcp', maxConnections })
  const seedPool = new pg.Pool({ connectionString: s.url, max: 1 }); await seed(seedPool); await seedPool.end()
  const db: any = postgres({ contract, url: s.url })
  const t = performance.now()
  const outcome = await Promise.race([
    Promise.all(Array.from({ length: 5 }, (_, i) => db.orm.public.Post.where({ authorId: i % 2 ? 'u1' : 'u2' }).all().then((r: any) => r.length))),
    new Promise((res) => setTimeout(() => res('TIMEOUT 10s'), 10_000)),
  ])
  console.log(`  server maxConnections=${maxConnections}: result=${JSON.stringify(outcome)} in ${(performance.now() - t).toFixed(0)}ms, server stats=${JSON.stringify(s.server.getStats())}`)
  await db.close(); await s.stop()
}
console.log('\n== concurrency: 5 concurrent inside 5 concurrent transactions (maxConnections=5) ==')
{
  const s = await startPglite({ mode: 'tcp', maxConnections: 5 })
  const seedPool = new pg.Pool({ connectionString: s.url, max: 1 }); await seed(seedPool); await seedPool.end()
  const db: any = postgres({ contract, url: s.url })
  const t = performance.now()
  const outcome = await Promise.race([
    Promise.all(Array.from({ length: 5 }, (_, i) => db.transaction(async (tx: any) => {
      await tx.orm.public.Post.create({ id: `t${i}`, title: 't', published: false, authorId: 'u1' })
      return (await tx.orm.public.Post.all()).length
    }))),
    new Promise((res) => setTimeout(() => res('TIMEOUT 10s'), 10_000)),
  ])
  console.log(`  result=${JSON.stringify(outcome)} in ${(performance.now() - t).toFixed(0)}ms`)
  await db.close(); await s.stop()
}
