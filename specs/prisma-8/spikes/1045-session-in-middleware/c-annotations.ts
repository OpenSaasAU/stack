import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
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

const sessionAnnotation = defineAnnotation<{ userId: string }>()({
  namespace: 'opensaas-session',
  applicableTo: ['read', 'write'] as const,
})

let unannotated = 0
const access: SqlMiddleware = {
  name: 'access-by-annotation',
  familyId: 'sql',
  async beforeCompile(draft) {
    const session = sessionAnnotation.read({ meta: draft.meta } as any)
    if (!session) {
      unannotated++
      return undefined
    }
    const userId = session.userId
    const ast: any = draft.ast
    if (!(ast instanceof SelectAst)) return undefined
    const pred = BinaryExpr.eq(
      ColumnRef.of('Post', 'authorId'),
      ParamRef.of(userId, { codec: frozenCodecRef({ codecId: 'pg/text@1' }) } as any),
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
const authors = (r: any[]) => [...new Set(r.map((x: any) => x.authorId))].sort().join(',')

console.log('annotation handle:', typeof sessionAnnotation, Object.keys(sessionAnnotation ?? {}))
console.log('\n-- annotated call site --')
try {
  const rows = await client.orm.public.Post.all((meta: any) =>
    meta.annotate(sessionAnnotation({ userId: 'alice' })),
  )
  console.log('  ->', authors(rows))
} catch (e: any) {
  console.log('  ERROR:', String(e.message).slice(0, 200))
}

console.log('\n-- call site that FORGOT the annotation --')
const rows2 = await client.orm.public.Post.all()
console.log('  ->', authors(rows2), '  (no error, no warning)')
console.log('\nunannotated compiles:', unannotated)
await client.close()
await pool.end()
