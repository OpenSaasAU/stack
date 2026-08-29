import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
const URL = 'postgres://postgres@127.0.0.1:5433/postgres'
const pool = new pg.Pool({ connectionString: URL, max: 2 })
const { contract } = await import('./contract.js')
const backends = async () =>
  (
    await pool.query(
      'select count(*)::int c from pg_stat_activity where datname=current_database()',
    )
  ).rows[0].c
const owned: any[] = []
for (let i = 0; i < 20; i++) {
  const c: any = postgres({ contract, url: URL })
  owned.push(c)
  await c.orm.public.Post.all()
}
console.log('after 20 url-clients:', await backends())
await Promise.all(owned.map((c) => c.close()))
console.log('immediately after close():', await backends())
await new Promise((r) => setTimeout(r, 2000))
console.log('2s after close():', await backends())
await pool.end()
