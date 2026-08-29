import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { contract } from './contract.js'

const URL = 'postgres://postgres@127.0.0.1:5433/postgres'
const contractJson = JSON.parse(JSON.stringify(contract))

function bench(label: string, n: number, fn: () => void) {
  fn() // warm
  const t = process.hrtime.bigint()
  for (let i = 0; i < n; i++) fn()
  const us = Number(process.hrtime.bigint() - t) / 1000 / n
  console.log(`${label.padEnd(46)} ${us.toFixed(1)} µs/construction`)
}

console.log('== construction cost (no query issued) ==')
bench('postgres({ contract, url })', 2000, () => {
  postgres({ contract, url: URL })
})
bench('postgres({ contractJson, url })', 2000, () => {
  postgres({ contractJson, url: URL })
})

const pool = new pg.Pool({ connectionString: URL, max: 5 })
bench('postgres({ contract, pg: sharedPool })', 2000, () => {
  postgres({ contract, pg: pool })
})

console.log('\n== is contractJson re-parsed/normalised per construction? ==')
const c1: any = postgres({ contractJson, url: URL })
const c2: any = postgres({ contractJson, url: URL })
console.log('contract identity shared across two clients:', c1.contract === c2.contract)
console.log('contract === the contractJson object passed in:', c1.contract === contractJson)
console.log(
  'storageHash stable:',
  c1.contract.storage.storageHash === c2.contract.storage.storageHash,
)

console.log('\n== query latency: shared client vs per-request client over one pool ==')
const shared: any = postgres({ contract, pg: pool })
await shared.orm.public.Post.all() // warm pool

async function timeIt(label: string, n: number, fn: () => Promise<unknown>) {
  await fn()
  const t = process.hrtime.bigint()
  for (let i = 0; i < n; i++) await fn()
  console.log(
    `${label.padEnd(46)} ${(Number(process.hrtime.bigint() - t) / 1e6 / n).toFixed(3)} ms/query`,
  )
}
await timeIt('shared client, N queries', 200, () =>
  shared.orm.public.Post.where({ authorId: 'alice' }).all(),
)
await timeIt('fresh client per query, shared pg.Pool', 200, () => {
  const c: any = postgres({ contract, pg: pool })
  return c.orm.public.Post.where({ authorId: 'alice' }).all()
})

console.log('\n== does a fresh client per request open a new connection? ==')
const before = (
  await pool.query('select count(*) from pg_stat_activity where datname=current_database()')
).rows[0].count
for (let i = 0; i < 50; i++) {
  const c: any = postgres({ contract, pg: pool })
  await c.orm.public.Post.all()
}
const after = (
  await pool.query('select count(*) from pg_stat_activity where datname=current_database()')
).rows[0].count
console.log(`backends before=${before} after 50 fresh clients=${after} (pool max=5)`)

await shared.close()
await pool.end()
