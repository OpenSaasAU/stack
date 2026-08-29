import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  SelectAst,
  AndExpr,
  ColumnRef,
  ParamRef,
  BinaryExpr,
  frozenCodecRef,
} from '@prisma/orm-postgres/relational-core/ast'
import { contract } from './contract.js'
import type { SqlMiddleware } from '@prisma/orm-family-sql/runtime'

type Session = { userId: string; sudo?: boolean }
const als = new AsyncLocalStorage<Session>()
let unscoped = 0

const access: SqlMiddleware = {
  name: 'opensaas-access',
  familyId: 'sql',
  async beforeCompile(draft) {
    const s = als.getStore()
    if (!s) {
      unscoped++
      return undefined
    } // <- deliberately fails OPEN, to observe
    if (s.sudo) return undefined
    const ast: any = draft.ast
    if (!(ast instanceof SelectAst)) return undefined
    const pred = BinaryExpr.eq(
      ColumnRef.of('Post', 'authorId'),
      ParamRef.of(s.userId, { codec: frozenCodecRef({ codecId: 'pg/text@1' }) } as any),
    )
    return {
      ast: ast.withWhere(ast.where ? AndExpr.of([ast.where, pred]) : pred),
      meta: draft.meta,
    }
  },
}
const pool = new pg.Pool({
  connectionString: 'postgres://postgres@127.0.0.1:5433/postgres',
  max: 5,
})
const client: any = postgres({ contract, pg: pool, middleware: [access] })
const P = () => client.orm.public.Post
const authors = (r: any[]) => [...new Set(r.map((x: any) => x.authorId))].sort().join(',')

console.log('== B1 scoping works when awaited in-scope ==')
await als.run({ userId: 'alice' }, async () => console.log('  alice ->', authors(await P().all())))
await als.run({ userId: 'bob' }, async () => console.log('  bob   ->', authors(await P().all())))

console.log('\n== B2 concurrent interleaved sessions (100 overlapping) ==')
const res = await Promise.all(
  Array.from({ length: 100 }, (_, i) => {
    const who = i % 2 ? 'bob' : 'alice'
    return als.run({ userId: who }, async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 15))
      const rows = await P().all()
      await new Promise((r) => setTimeout(r, Math.random() * 5))
      const rows2 = await P().where({ published: true }).all()
      return [...rows, ...rows2].some((r: any) => r.authorId !== who)
    })
  }),
)
console.log('  cross-session leaks:', res.filter(Boolean).length, '/ 100')

console.log('\n== B3 across db.transaction() ==')
await als.run({ userId: 'alice' }, async () => {
  const r = await client.transaction(async (tx: any) => {
    const a = await tx.orm.public.Post.all()
    const b = await tx.orm.public.Post.where({ published: true }).all()
    return [...a, ...b]
  })
  console.log('  inside tx, alice ->', authors(r))
})
console.log('  tx with a concurrent other session running:')
await Promise.all([
  als.run({ userId: 'alice' }, () =>
    client.transaction(async (tx: any) => {
      const a = await tx.orm.public.Post.all()
      await new Promise((r) => setTimeout(r, 10))
      const b = await tx.orm.public.Post.all()
      console.log('    tx(alice) ->', authors([...a, ...b]))
    }),
  ),
  als.run({ userId: 'bob' }, async () => {
    await new Promise((r) => setTimeout(r, 5))
    console.log('    bob      ->', authors(await P().all()))
  }),
])

console.log('\n== B4 streaming AsyncIterableResult ==')
await als.run({ userId: 'alice' }, async () => {
  const out: string[] = []
  for await (const row of P().all() as any) out.push(row.authorId)
  console.log('  for-await fully in scope ->', [...new Set(out)].join(','))
})
{
  let it: any
  await als.run({ userId: 'alice' }, async () => {
    it = (P().all() as any)[Symbol.asyncIterator]()
  })
  const out: string[] = []
  for (let r = await it.next(); !r.done; r = await it.next()) out.push(r.value.authorId)
  console.log(
    '  iterator obtained in scope, drained OUTSIDE ->',
    [...new Set(out)].join(','),
    '(unscoped so far:',
    unscoped + ')',
  )
}

console.log('\n== B5 sudo (nested als.run) ==')
await als.run({ userId: 'alice' }, async () => {
  console.log('  alice        ->', authors(await P().all()))
  await als.run({ userId: 'alice', sudo: true }, async () =>
    console.log('  sudo         ->', authors(await P().all())),
  )
  console.log('  back to alice->', authors(await P().all()))
})

console.log('\n== B6 the escape hatch that silently reads unscoped ==')
const before = unscoped
console.log(
  '  als.run(s, () => P().all())  ->',
  authors(await als.run({ userId: 'alice' }, () => P().all())),
)
console.log('  unscoped compiles since B5:', unscoped - before)
console.log('\nTOTAL unscoped beforeCompile invocations this run:', unscoped)
await client.close()
await pool.end()
