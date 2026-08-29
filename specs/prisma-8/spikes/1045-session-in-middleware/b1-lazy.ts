import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { contract } from './contract.js'
import type { SqlMiddleware } from '@prisma/orm-family-sql/runtime'

const als = new AsyncLocalStorage<{ userId: string }>()
let last: unknown
const mw: SqlMiddleware = {
  name: 'diag',
  familyId: 'sql',
  async beforeCompile() {
    last = als.getStore()
    return undefined
  },
}
const pool = new pg.Pool({
  connectionString: 'postgres://postgres@127.0.0.1:5433/postgres',
  max: 5,
})
const client: any = postgres({ contract, pg: pool, middleware: [mw] })
const P = () => client.orm.public.Post

const check = async (label: string, run: () => Promise<unknown>) => {
  last = 'NOT-SET'
  await run()
  console.log(`${label.padEnd(58)} -> ${JSON.stringify(last)}`)
}

console.log(
  'is .all() a Promise?',
  P().all() instanceof Promise,
  '| ctor:',
  P().all().constructor.name,
)
console.log()
await check('als.run(s, () => Post.all())            [return thenable]', () =>
  als.run({ userId: 'a' }, () => P().all()),
)
await check('als.run(s, async () => await Post.all())[await inside] ', () =>
  als.run({ userId: 'a' }, async () => {
    await P().all()
  }),
)
await check('als.run(s, () => Post.all().then(x=>x)) [then inside]  ', () =>
  als.run({ userId: 'a' }, () =>
    P()
      .all()
      .then((x: any) => x),
  ),
)
await check('const p = inside; await p outside                      ', async () => {
  let p: any
  als.run({ userId: 'a' }, () => {
    p = P().all()
  })
  await p
})
await check('als.run(s, () => Promise.resolve().then(()=>Post.all()))', () =>
  als.run({ userId: 'a' }, () => Promise.resolve().then(() => P().all())),
)
await check('als.run(s, async () => await Post.where(...).all())     ', () =>
  als.run({ userId: 'a' }, async () => {
    await P().where({ authorId: 'alice' }).all()
  }),
)
await check('als.run(s, async () => await Post.first())              ', () =>
  als.run({ userId: 'a' }, async () => {
    await P().first()
  }),
)
await check('als.run(s, async () => await client.transaction(...))   ', () =>
  als.run({ userId: 'a' }, async () => {
    await client.transaction(async (tx: any) => tx.orm.public.Post.all())
  }),
)
await client.close()
await pool.end()
