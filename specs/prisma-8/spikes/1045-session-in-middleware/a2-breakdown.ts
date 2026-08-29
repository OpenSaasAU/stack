import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { contract } from './contract.js'
import { bigContract } from './big-contract.js'

const URL = 'postgres://postgres@127.0.0.1:5433/postgres'
const pool = new pg.Pool({ connectionString: URL, max: 5 })

async function timeIt(label: string, n: number, fn: () => Promise<unknown>) {
  await fn()
  const t = process.hrtime.bigint()
  for (let i = 0; i < n; i++) await fn()
  console.log(
    `${label.padEnd(52)} ${(Number(process.hrtime.bigint() - t) / 1e6 / n).toFixed(3)} ms`,
  )
}

for (const [name, c] of [
  ['1-model contract', contract],
  ['41-model contract', bigContract],
] as const) {
  console.log(`\n== ${name} ==`)
  const shared: any = postgres({ contract: c as any, pg: pool })
  await shared.orm.public.Post.all()

  // pre-built fresh clients, so timing excludes construction
  const pre: any[] = Array.from({ length: 300 }, () => postgres({ contract: c as any, pg: pool }))
  let k = 0

  await timeIt('shared client, query', 200, () =>
    shared.orm.public.Post.where({ authorId: 'alice' }).all(),
  )
  await timeIt('fresh client (pre-built), first query on it', 200, () =>
    pre[k++].orm.public.Post.where({ authorId: 'alice' }).all(),
  )
  await timeIt('construct + query', 200, () => {
    const x: any = postgres({ contract: c as any, pg: pool })
    return x.orm.public.Post.where({ authorId: 'alice' }).all()
  })

  const t = process.hrtime.bigint()
  for (let i = 0; i < 500; i++) postgres({ contract: c as any, pg: pool })
  console.log(
    `${'construct only'.padEnd(52)} ${(Number(process.hrtime.bigint() - t) / 1e6 / 500).toFixed(3)} ms`,
  )
}
await pool.end()
