// FACT A (cont.): why concurrent transactions hang on PGlite — the first-use marker read vs PGLiteSocketServer's transaction-held queue.
import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { contract, DDL } from './contract.ts'
import { startPglite } from './pglite-server.ts'

const seed = async (pool: pg.Pool) => {
  await pool.query(DDL)
  await pool.query(`insert into "User" values ('u1','alice') on conflict do nothing`)
}
const race = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<string>((r) => setTimeout(() => r(`TIMEOUT ${ms}ms`), ms))])
const causeChain = (e: any) => { const out: string[] = []; let c = e; while (c) { out.push(`${c.constructor?.name}: ${String(c.message).slice(0, 100)}`); c = c.cause }; return out.join(' <- ') }

type Variant = { label: string; maxConnections: number; poolMax?: number; verifyMarker?: false; warmup: boolean; n: number }
const variants: Variant[] = [
  { label: 'url, no warm-up, default verifyMarker', maxConnections: 10, warmup: false, n: 5 },
  { label: 'url, WARM-UP query first', maxConnections: 10, warmup: true, n: 5 },
  { label: 'url, verifyMarker:false, no warm-up', maxConnections: 10, verifyMarker: false, warmup: false, n: 5 },
  { label: 'pg Pool max=1, verifyMarker:false', maxConnections: 1, poolMax: 1, verifyMarker: false, warmup: false, n: 5 },
  { label: 'pg Pool max=1, default verifyMarker, no warm-up', maxConnections: 1, poolMax: 1, warmup: false, n: 1 },
  { label: 'pg Pool max=1, default verifyMarker, WARM-UP', maxConnections: 1, poolMax: 1, warmup: true, n: 5 },
  { label: 'pg Pool max=2, default verifyMarker, no warm-up', maxConnections: 2, poolMax: 2, warmup: false, n: 5 },
]
for (const v of variants) {
  const s = await startPglite({ mode: 'tcp', maxConnections: v.maxConnections })
  const seedPool = new pg.Pool({ connectionString: s.url, max: 1 }); await seed(seedPool); await seedPool.end()
  const pool = v.poolMax ? new pg.Pool({ connectionString: s.url, max: v.poolMax }) : undefined
  const opts: any = { contract, ...(v.verifyMarker === false ? { verifyMarker: false } : {}) }
  const db: any = pool ? postgres({ ...opts, pg: pool }) : postgres({ ...opts, url: s.url })
  if (v.warmup) await db.orm.public.User.all()
  const t = performance.now()
  let outcome: unknown
  try {
    outcome = await race(Promise.all(Array.from({ length: v.n }, (_, i) => db.transaction(async (tx: any) => {
      await tx.orm.public.Post.create({ id: `t${i}`, title: 't', published: false, authorId: 'u1' })
      return (await tx.orm.public.Post.all()).length
    }))), 8000)
  } catch (e: any) { outcome = 'ERROR ' + causeChain(e) }
  console.log(`${v.label.padEnd(52)} n=${v.n} -> ${JSON.stringify(outcome)} in ${(performance.now() - t).toFixed(0)}ms  server=${JSON.stringify(s.server.getStats())}`)
  // teardown even if hung: end pool with force
  try { await race(db.close(), 2000) } catch {}
  try { await race(pool?.end() ?? Promise.resolve(), 2000) } catch {}
  try { await race(s.stop(), 3000) } catch {}
}
process.exit(0)
