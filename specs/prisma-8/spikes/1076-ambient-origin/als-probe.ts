// #1076 probe: can an AsyncLocalStorage "origin" entered by the executing surface be read
// in beforeCompile on EVERY statement of a logical call, including the emptyState() follow-ups
// that per-plan annotations cannot reach? And does it leak into foreign queries?
import { AsyncLocalStorage } from 'node:async_hooks'
import postgres from '@prisma/orm-postgres/runtime'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import pg from 'pg'
import { contract, DDL } from './contract.ts'
import { startPglite } from './pglite-server.ts'

type Origin = { origin: 'engine' | 'unsafe'; tag?: string }
const originStore = new AsyncLocalStorage<Origin>()

type Seen = {
  lane: string
  kind: string
  origin: string | null
  tag?: string
  scope: string
  execId: string
  annotated: boolean
}
let seen: Seen[] = []
let throwMode = false
class UnstampedQueryError extends Error {}
const tripwire: SqlMiddleware = {
  name: 'opensaas-tripwire',
  familyId: 'sql',
  async beforeCompile(draft: any, ctx: any) {
    const o = originStore.getStore()
    seen.push({
      lane: draft.meta.lane,
      kind: draft.ast.kind,
      origin: o?.origin ?? null,
      tag: o?.tag,
      scope: ctx.scope,
      execId: String(ctx.planExecutionId).slice(0, 6),
      annotated: draft.meta.annotations !== undefined,
    })
    if (throwMode && !o)
      throw new UnstampedQueryError(`unstamped ${draft.meta.lane}/${draft.ast.kind}`)
    return undefined
  },
}

const s = await startPglite({ mode: 'tcp', maxConnections: 10 })
const seedPool = new pg.Pool({ connectionString: s.url, max: 1 })
await seedPool.query(DDL)
await seedPool.query(`insert into "User" values ('u1','alice'),('u2','bob') on conflict do nothing`)
await seedPool.query(
  `insert into "Post" values ('p1','t1',false,'u1'),('p2','t2',true,'u1'),('p3','t3',true,'u2') on conflict do nothing`,
)
await seedPool.end()

const db: any = postgres({ contract, url: s.url, middleware: [tripwire], verifyMarker: false })
const orm = db.orm.public

const engine = <T>(tag: string, fn: () => Promise<T>) =>
  originStore.run({ origin: 'engine', tag }, async () => await fn())
const unsafe = <T>(tag: string, fn: () => Promise<T>) =>
  originStore.run({ origin: 'unsafe', tag }, async () => await fn())
const engineLazy = <T>(tag: string, fn: () => T) => originStore.run({ origin: 'engine', tag }, fn)

const summary = (label: string) => {
  const n = seen.length
  const covered = seen.filter((x) => x.origin !== null).length
  console.log(
    `${label.padEnd(58)} statements=${n} origin-visible=${covered}/${n}  ${seen.map((x) => `${x.kind}:${x.origin ?? '-'}${x.tag ? '(' + x.tag + ')' : ''}[${x.scope}]`).join(' ')}`,
  )
}
async function measure(label: string, fn: () => Promise<unknown>) {
  seen = []
  let err: string | undefined
  try {
    await fn()
  } catch (e: any) {
    err = `${e.constructor?.name}: ${String(e.message).slice(0, 80)}`
  }
  summary(label)
  if (err) console.log(`   -> threw ${err}`)
}

console.log('\n== A. coverage: every statement of a logical call, executor wrapped in als.run ==')
await measure('A0 TRAP all() returned from run, awaited outside', () =>
  engineLazy('r', () => orm.Post.where({ authorId: 'u1' }).all()),
)
await measure('A1 all() awaited inside run', () =>
  engine('r', () => orm.Post.where({ authorId: 'u1' }).all()),
)
await measure('A2 include().all()', () => engine('r', () => orm.User.include('posts').all()))
await measure('A3 update() one row', () =>
  engine('w', () => orm.Post.where({ id: 'p1' }).update({ title: 'x' })),
)
await measure('A4 delete() one row', () => engine('w', () => orm.Post.where({ id: 'p3' }).delete()))
await measure('A5 nested create (User + posts)', () =>
  engine('w', () =>
    orm.User.create({
      id: 'u3',
      name: 'c',
      posts: (p: any) => p.create([{ id: 'p4', title: 'n', published: false }]),
    }),
  ),
)
await measure('A6 nested connect (Post -> author)', () =>
  engine('w', () =>
    orm.Post.create({
      id: 'p5',
      title: 'c',
      published: false,
      author: (a: any) => a.connect({ id: 'u2' }),
    }),
  ),
)
await measure('A7 updateAll()', () =>
  engine('w', () => orm.Post.where({ authorId: 'u1' }).updateAll({ published: true })),
)
await measure('A8 deleteAll() with include', () =>
  engine('w', () => orm.Post.where({ id: 'p5' }).include('author').deleteAll()),
)
await measure('A9 aggregate count', () =>
  engine('r', () => orm.Post.aggregate((a: any) => ({ n: a.count() }))),
)
await measure('A10 transaction: two terminal calls, each wrapped', () =>
  db.transaction(async (tx: any) => {
    await engine('t1', () => tx.orm.public.Post.where({ id: 'p1' }).update({ title: 'y' }))
    await engine('t2', () => tx.orm.public.Post.where({ id: 'p1' }).first())
  }),
)
await measure('A11 raw affectedCount via runtime().execute in unsafe', () =>
  unsafe('raw', async () => {
    const plan = db.raw.sql`UPDATE "public"."Post" SET "title" = "title" WHERE "id" = ${'nope'}`
      .affectedCount()
      .build()
    return db.runtime().execute(plan)
  }),
)
await measure('A12 dsl select via runtime().query in unsafe', () =>
  unsafe('dsl', async () => {
    const plan = db.sql.public.Post.select('id').build()
    const rows = []
    for await (const r of db.runtime().query(plan)) rows.push(r)
    return rows
  }),
)
await measure(
  'A13 streaming: iterator obtained+first next() inside run, rest outside',
  async () => {
    const it = engineLazy('r', () => {
      const r = orm.Post.all()
      const i = r[Symbol.asyncIterator]()
      return { i, firstNext: i.next() }
    })
    const rows = [await it.firstNext]
    for (;;) {
      const n = await it.i.next()
      if (n.done) break
      rows.push(n)
    }
    return rows
  },
)
await measure('A14 first()', () => engine('r', () => orm.Post.where({ id: 'p1' }).first()))
await measure('A15 upsert()', () =>
  engine('w', () =>
    orm.Post.upsert({
      where: { id: 'p1' },
      create: { id: 'p1', title: 'u', published: false, authorId: 'u1' },
      update: { title: 'u' },
    }),
  ),
)

console.log('\n== B. non-leakage and fail direction (tripwire throwing) ==')
throwMode = true
await measure('B1 foreign query outside any run', () => orm.Post.all())
await measure('B2 value built inside run, executed outside', async () => {
  const q = originStore.run({ origin: 'engine', tag: 'build' }, () => orm.Post.where({ id: 'p1' }))
  return q.all()
})
await measure('B3 value built outside, executed inside run', async () => {
  const q = orm.Post.where({ id: 'p1' })
  return engine('exec', () => q.all())
})
await measure('B4 hook-shaped: query issued from als.exit inside a run', () =>
  engine('outer', () => originStore.exit(() => orm.Post.all())),
)
await measure('B5 hook-shaped: query issued from run(undefined) inside a run', () =>
  engine('outer', () => originStore.run(undefined as any, () => orm.Post.all())),
)
await measure('B6 update() inside run whose 2nd statement must be covered', () =>
  engine('w', () => orm.Post.where({ id: 'p1' }).update({ title: 'z' })),
)
await measure('B7 foreign query inside db.transaction callback, unwrapped', () =>
  db.transaction(async (tx: any) => tx.orm.public.Post.all()),
)
throwMode = false

console.log(
  '\n== C. interleaving: 60 concurrent logical calls, alternating engine / unsafe / foreign ==',
)
seen = []
const kinds = ['engine', 'unsafe', 'none'] as const
const results = await Promise.all(
  Array.from({ length: 60 }, (_, i) => {
    const k = kinds[i % 3]
    const tag = `c${i}`
    const call = () => orm.Post.where({ id: 'p1' }).update({ title: `t${i}` })
    if (k === 'engine') return engine(tag, call).then(() => ({ tag, k }))
    if (k === 'unsafe') return unsafe(tag, call).then(() => ({ tag, k }))
    return call().then(() => ({ tag, k }))
  }),
)
{
  const byTag = new Map<string, Seen[]>()
  for (const x of seen) {
    const key = x.tag ?? 'none'
    byTag.set(key, [...(byTag.get(key) ?? []), x])
  }
  let ok = true
  for (const r of results) {
    const mine = byTag.get(r.k === 'none' ? 'none' : r.tag) ?? []
    if (r.k !== 'none') {
      const good = mine.length === 2 && mine.every((x) => x.origin === r.k && x.tag === r.tag)
      if (!good) {
        ok = false
        console.log('  MISMATCH', r, mine)
      }
    }
  }
  const none = byTag.get('none') ?? []
  console.log(
    `  statements=${seen.length} (expected 120); foreign statements with no origin=${none.length} (expected 40); every wrapped call saw exactly its own tag on both statements: ${ok}`,
  )
}

console.log(
  '\n== D. a generic Proxy that wraps every method of an ORM collection in als.run (the Unsafe ORM lane) ==',
)
const STORE: Origin = { origin: 'unsafe', tag: 'proxy' }
const inScope = <T>(fn: () => T) => originStore.run(STORE, fn)
const isCollection = (x: any) =>
  x && typeof x === 'object' && typeof x.all === 'function' && typeof x.where === 'function'
function wrapResult(r: any): any {
  if (r && typeof r.then === 'function' && typeof r[Symbol.asyncIterator] === 'function') {
    return {
      then: (a: any, b: any) => inScope(() => r.then(a, b)),
      toArray: () => inScope(() => r.toArray()),
      first: () => inScope(() => r.first()),
      [Symbol.asyncIterator]: () => {
        const it = inScope(() => r[Symbol.asyncIterator]())
        return {
          next: (...x: any[]) => inScope(() => it.next(...x)),
          return: (...x: any[]) => inScope(() => it.return?.(...x)),
          throw: (...x: any[]) => inScope(() => it.throw?.(...x)),
        }
      },
    }
  }
  return isCollection(r) ? wrapUnsafe(r) : r
}
function wrapUnsafe<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv)
      if (typeof v !== 'function') return v
      return (...args: unknown[]) => wrapResult(inScope(() => v.apply(t, args)))
    },
  })
}
const unsafeOrm = new Proxy(orm, { get: (t, p) => wrapUnsafe(Reflect.get(t, p)) }) as any
throwMode = true
await measure('D1 unsafeOrm.Post.where().update() - 2 statements', () =>
  unsafeOrm.Post.where({ id: 'p1' }).update({ title: 'p' }),
)
await measure('D2 unsafeOrm.User.create nested posts - 3 statements', () =>
  unsafeOrm.User.create({
    id: 'u4',
    name: 'd',
    posts: (p: any) => p.create([{ id: 'p6', title: 'n', published: false }]),
  }),
)
await measure('D3 chain built, terminal called later outside any run', async () => {
  const q = unsafeOrm.Post.where({ id: 'p1' })
  await new Promise((r) => setTimeout(r, 5))
  return q.all()
})
await measure('D4 include refinement callback', () =>
  unsafeOrm.User.include('posts', (p: any) => p.where({ published: true })).all(),
)
await measure('D5 streaming for-await over proxied all()', async () => {
  const rows = []
  for await (const r of unsafeOrm.Post.all()) rows.push(r)
  return rows
})
await measure('D6 first() through proxy', () => unsafeOrm.Post.where({ id: 'p1' }).first())
await measure('D7 aggregate through proxy', () =>
  unsafeOrm.Post.aggregate((a: any) => ({ n: a.count() })),
)
throwMode = false

console.log(
  '\n== G. the Unsafe executor: query(plan) must return a lazy AsyncIterableResult, consumed outside any scope ==',
)
const UNSAFE_EXEC: Origin = { origin: 'unsafe', tag: 'exec' }
const unsafeQueryNaive = (plan: any) => originStore.run(UNSAFE_EXEC, () => db.runtime().query(plan))
const unsafeQuery = (plan: any) => {
  const r: any = originStore.run(UNSAFE_EXEC, () => db.runtime().query(plan))
  const enter = <T>(fn: () => T) => originStore.run(UNSAFE_EXEC, fn)
  return {
    then: (a: any, b: any) => enter(() => r.then(a, b)),
    toArray: () => enter(() => r.toArray()),
    first: () => enter(() => r.first()),
    firstOrThrow: () => enter(() => r.firstOrThrow()),
    [Symbol.asyncIterator]: () => {
      const it = enter(() => r[Symbol.asyncIterator]())
      return {
        next: (...x: any[]) => enter(() => it.next(...x)),
        return: (...x: any[]) => enter(() => it.return?.(...x)),
        throw: (...x: any[]) => enter(() => it.throw?.(...x)),
      }
    },
  }
}
const unsafeExecute = (plan: any) => originStore.run(UNSAFE_EXEC, () => db.runtime().execute(plan))
throwMode = true
await measure(
  'G1 NAIVE: return runtime().query(plan) from the scope, for-await outside',
  async () => {
    const rows = []
    for await (const r of unsafeQueryNaive(db.sql.public.Post.select('id').build())) rows.push(r)
    return rows
  },
)
await measure('G2 wrapper: for-await streaming outside any scope', async () => {
  const rows = []
  for await (const r of unsafeQuery(db.sql.public.Post.select('id').build())) rows.push(r)
  return rows
})
await measure('G3 wrapper: await (then) outside any scope', () =>
  unsafeQuery(db.sql.public.Post.select('id').build()),
)
await measure('G4 wrapper: .first() outside any scope', () =>
  unsafeQuery(db.sql.public.Post.select('id').build()).first(),
)
await measure('G5 wrapper: held 5 ms, then consumed', async () => {
  const q = unsafeQuery(db.sql.public.Post.select('id').build())
  await new Promise((r) => setTimeout(r, 5))
  const rows = []
  for await (const x of q) rows.push(x)
  return rows
})
await measure('G6 wrapper: raw returnsRow plan streamed outside', async () => {
  const rows = []
  for await (const r of unsafeQuery(
    db.raw.sql`SELECT "id" FROM "public"."Post"`.returnsRow({ id: 'pg/text@1' }).build(),
  ))
    rows.push(r)
  return rows
})
await measure('G7 execute(plan): eager, returned from the scope, awaited outside', () =>
  unsafeExecute(
    db.raw.sql`UPDATE "public"."Post" SET "title" = "title" WHERE "id" = ${'nope'}`
      .affectedCount()
      .build(),
  ),
)
throwMode = false

console.log('\n== E. cost of als.run around a terminal (warm, 2000 iterations each) ==')
{
  const N = 2000
  const q = orm.Post.where({ id: 'p1' })
  for (let i = 0; i < 50; i++) await q.first()
  let bare = 0,
    wrapped = 0
  for (let round = 0; round < 5; round++) {
    let t = performance.now()
    for (let i = 0; i < N / 5; i++) await q.first()
    bare += performance.now() - t
    t = performance.now()
    for (let i = 0; i < N / 5; i++) await engine('e', () => q.first())
    wrapped += performance.now() - t
  }
  console.log(
    `  first() bare ${(bare / N).toFixed(4)} ms   inside als.run ${(wrapped / N).toFixed(4)} ms   delta ${(((wrapped - bare) / N) * 1000).toFixed(1)} µs (interleaved rounds)`,
  )
  let t = performance.now()
  for (let i = 0; i < 100000; i++) originStore.run(STORE, () => 1)
  console.log(
    `  bare als.run(sync fn) ${(((performance.now() - t) / 100000) * 1000).toFixed(3)} µs`,
  )
}

console.log(
  '\n== F. prepare(): does beforeCompile run per execution, and which origin does it see? ==',
)
{
  seen = []
  try {
    const prepared: any = await engine('prep', () =>
      db.prepare({ id: 'pg/text@1' }, (sql: any, params: any) =>
        sql.public.Post.where((p: any) => p.id.eq(params.id))
          .select('id')
          .build(),
      ),
    )
    summary('  F1 prepare() itself')
    const names = new Set<string>()
    let o = prepared
    while (o && o !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(o)) names.add(k)
      o = Object.getPrototypeOf(o)
    }
    console.log('  prepared members:', [...names].filter((n) => n !== 'constructor').join(','))
    const exec = async () => {
      const r = prepared.query
        ? prepared.query({ id: 'p1' })
        : prepared.all
          ? prepared.all({ id: 'p1' })
          : prepared.execute({ id: 'p1' })
      const rows = []
      for await (const x of r) rows.push(x)
      return rows
    }
    seen = []
    console.log('  rows:', JSON.stringify(await exec()))
    summary('  F2 execute prepared, outside any run')
    seen = []
    await unsafe('exec', exec)
    summary('  F3 execute prepared again, inside unsafe run')
  } catch (e: any) {
    console.log('  prepare probe failed:', e.constructor?.name, String(e.message).slice(0, 200))
  }
}

await db.close()
await s.stop()
process.exit(0)
