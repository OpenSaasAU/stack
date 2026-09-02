// FACT C: what beforeCompile sees. Prints draft.ast JSON and draft.meta.annotations.
import postgres from '@prisma/orm-postgres/runtime'
import { defineAnnotation } from '@prisma/orm-postgres/components/runtime'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import { contract } from './contract.ts'

const sessionAnnotation = defineAnnotation<{ userId: string }>()({
  namespace: 'opensaas-session',
  applicableTo: ['read', 'write'] as const,
})

const drafts: any[] = []
const recorder: SqlMiddleware = {
  name: 'recorder',
  familyId: 'sql',
  async beforeCompile(draft, ctx) {
    drafts.push({ draft, ctxKeys: Object.keys(ctx) })
    return undefined
  },
}
const fake = {
  escapeIdentifier: (s: string) => s,
  escapeLiteral: (s: string) => s,
  on() {
    return this
  },
  async connect() {},
  async end() {},
  async query(cfg: any) {
    const text = typeof cfg === 'string' ? cfg : cfg.text
    console.log('   SQL:', text, JSON.stringify(cfg.values ?? []))
    if (/marker|information_schema/.test(text)) return { rows: [], rowCount: 0 }
    if (/FROM "public"."User"/.test(text))
      return { rows: [{ id: 'u1', name: 'a', posts: [] }], rowCount: 1 }
    if (/"Post"/.test(text))
      return { rows: [{ id: 'p1', title: 't', published: true, authorId: 'u1' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  },
}
const db: any = postgres({ contract, pg: fake as any, middleware: [recorder] })

const replacer = (_k: string, v: any) =>
  v instanceof Map
    ? Object.fromEntries(v)
    : v instanceof Set
      ? [...v]
      : typeof v === 'bigint'
        ? String(v)
        : v
async function show(label: string, fn: () => Promise<unknown>) {
  drafts.length = 0
  console.log(`\n== ${label} ==`)
  await fn()
  for (const { draft, ctxKeys } of drafts) {
    console.log('   ast class:', draft.ast?.constructor?.name, ' ctx keys:', ctxKeys.join(','))
    console.log(
      '   ast JSON:',
      JSON.stringify(draft.ast, replacer, 2)
        .split('\n')
        .map((l: string) => '     ' + l)
        .join('\n'),
    )
    console.log(
      '   meta:',
      JSON.stringify(draft.meta, replacer, 2)
        .split('\n')
        .map((l: string) => '     ' + l)
        .join('\n'),
    )
    console.log(
      '   meta ownKeys:',
      Reflect.ownKeys(draft.meta).map(String).join(','),
      ' meta.annotations:',
      draft.meta.annotations === undefined
        ? 'undefined'
        : draft.meta.annotations?.constructor?.name,
      JSON.stringify(draft.meta.annotations, replacer),
      ' read():',
      JSON.stringify(sessionAnnotation.read({ meta: draft.meta } as any)),
    )
    const a = JSON.stringify(draft.ast, replacer)
    const b = JSON.stringify(draft.ast, replacer)
    console.log('   JSON stable across two stringifies:', a === b, ' size:', a.length, 'bytes')
  }
}

await show('Post.where({authorId:"u1", published:true}).orderBy? limit(5).all()', () =>
  db.orm.public.Post.where({ authorId: 'u1', published: true }).limit(5).all(),
)
{
  let methods: string[] = []
  db.orm.public.Post.where((p: any) => {
    methods = Object.keys(p.title).concat(
      Object.getOwnPropertyNames(Object.getPrototypeOf(p.title)),
    )
    return p.published.eq(true)
  })
  console.log(
    '\nfield proxy methods on p.title:',
    methods.filter((m) => m !== 'constructor').join(', '),
  )
}
await show('Post.where(p => p.title.like("%x%")).select id,title .all(annotated)', () =>
  db.orm.public.Post.where((p: any) => p.title.like('%x%'))
    .select('id', 'title')
    .all((meta: any) => meta.annotate(sessionAnnotation({ userId: 'alice' }))),
)
await show('Post.create({...})', () =>
  db.orm.public.Post.create({ id: 'p1', title: 't', published: false, authorId: 'u1' }),
)
await show('Post.where({id}).update({published:true}) annotated', () =>
  db.orm.public.Post.where({ id: 'p1' }).update({ published: true }, (meta: any) =>
    meta.annotate(sessionAnnotation({ userId: 'bob' })),
  ),
)
await show('User.include("posts").all()', () => db.orm.public.User.include('posts').all())

// Determinism across two identical queries: same JSON?
drafts.length = 0
await db.orm.public.Post.where({ authorId: 'u1' }).all()
const j1 = JSON.stringify(drafts[0].draft.ast, replacer)
drafts.length = 0
await db.orm.public.Post.where({ authorId: 'u1' }).all()
const j2 = JSON.stringify(drafts[0].draft.ast, replacer)
console.log('\nsame query twice -> identical AST JSON:', j1 === j2)
await db.close()
