import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { defineAnnotation } from '@prisma/orm-framework/components/runtime'
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

const URL = 'postgres://postgres@127.0.0.1:5433/postgres'
const pool = new pg.Pool({ connectionString: URL, max: 5 })
const als = new AsyncLocalStorage<{ userId: string | null; sudo?: boolean }>()
const sessionAnn = defineAnnotation<{ userId: string | null; sudo?: boolean }>()({
  namespace: 'opensaas-session',
  applicableTo: ['read', 'write'] as const,
})

const scope = (draft: any, s: any) => {
  if (s.sudo) return undefined
  if (!(draft.ast instanceof SelectAst)) return undefined
  const pred = BinaryExpr.eq(
    ColumnRef.of('Post', 'authorId'),
    ParamRef.of(s.userId, { codec: frozenCodecRef({ codecId: 'pg/text@1' }) } as any),
  )
  return {
    ast: draft.ast.withWhere(draft.ast.where ? AndExpr.of([draft.ast.where, pred]) : pred),
    meta: draft.meta,
  }
}
const alsMw: SqlMiddleware = {
  name: 'als',
  familyId: 'sql',
  async beforeCompile(d) {
    const s = als.getStore()
    if (!s) throw new Error('ACCESS.NO_SESSION: query compiled outside a session scope')
    return scope(d, s)
  },
}
const annMw: SqlMiddleware = {
  name: 'ann',
  familyId: 'sql',
  async beforeCompile(d) {
    const s = sessionAnn.read({ meta: d.meta } as any)
    if (!s) throw new Error('ACCESS.NO_SESSION: query compiled without a session annotation')
    return scope(d, s)
  },
}

const A: any = postgres({ contract, pg: pool, middleware: [alsMw] })
const B: any = postgres({ contract, pg: pool, middleware: [annMw] })
const authors = (r: any[]) => [...new Set(r.map((x: any) => x.authorId))].sort().join(',')
const attempt = async (label: string, fn: () => Promise<any>) => {
  try {
    console.log(`  ${label.padEnd(48)} -> rows from ${authors(await fn())}`)
  } catch (e: any) {
    console.log(`  ${label.padEnd(48)} -> THREW ${String(e.message).slice(0, 62)}`)
  }
}

console.log('== D1 ALS, fail-closed middleware ==')
await attempt('awaited in scope', () =>
  als.run({ userId: 'alice' }, async () => A.orm.public.Post.all()),
)
await attempt('tail-return out of scope (the escape)', () =>
  als.run({ userId: 'alice' }, () => A.orm.public.Post.all()),
)
await attempt('no scope at all', () => A.orm.public.Post.all())
await attempt('sudo in scope', () =>
  als.run({ userId: 'alice', sudo: true }, async () => A.orm.public.Post.all()),
)

console.log('\n== D2 annotations, fail-closed middleware ==')
await attempt('annotated', () =>
  B.orm.public.Post.all((m: any) => m.annotate(sessionAnn({ userId: 'alice' }))),
)
await attempt('annotation omitted (the escape)', () => B.orm.public.Post.all())
await attempt('sudo annotation', () =>
  B.orm.public.Post.all((m: any) => m.annotate(sessionAnn({ userId: null, sudo: true }))),
)
await attempt('annotated, inside transaction', () =>
  B.transaction(async (tx: any) =>
    tx.orm.public.Post.all((m: any) => m.annotate(sessionAnn({ userId: 'bob' }))),
  ),
)
await attempt('annotation omitted inside transaction', () =>
  B.transaction(async (tx: any) => tx.orm.public.Post.all()),
)

console.log('\n== D3 rebinding cost: als.run vs a fresh client ==')
const t1 = process.hrtime.bigint()
for (let i = 0; i < 100000; i++) als.run({ userId: 'alice' }, () => 0)
console.log(
  `  als.run rebind                                 ${(Number(process.hrtime.bigint() - t1) / 1e3 / 100000).toFixed(3)} µs`,
)
const t2 = process.hrtime.bigint()
for (let i = 0; i < 500; i++) postgres({ contract, pg: pool, middleware: [alsMw] })
console.log(
  `  fresh client rebind (1-model contract)         ${(Number(process.hrtime.bigint() - t2) / 1e3 / 500).toFixed(1)} µs`,
)

console.log('\n== D4 per-request client with url: (own pool) vs pg: (shared pool) ==')
const backends = async () =>
  (
    await pool.query(
      'select count(*)::int c from pg_stat_activity where datname=current_database()',
    )
  ).rows[0].c
console.log('  backends now:', await backends())
const owned: any[] = []
for (let i = 0; i < 20; i++) {
  const c: any = postgres({ contract, url: URL, middleware: [alsMw] })
  owned.push(c)
  await als.run({ userId: 'alice' }, async () => c.orm.public.Post.all())
}
console.log('  after 20 clients constructed with url:          backends =', await backends())
await Promise.all(owned.map((c) => c.close()))
console.log('  after closing them:                            backends =', await backends())
await A.close()
await B.close()
await pool.end()
