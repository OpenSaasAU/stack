// #1076 probe 2: prepare(), hook-shaped exits, per-terminal laziness, and what a mid-transaction refusal does.
import { AsyncLocalStorage } from 'node:async_hooks'
import postgres from '@prisma/orm-postgres/runtime'
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime'
import pg from 'pg'
import { contract, DDL } from './contract.ts'
import { startPglite } from './pglite-server.ts'

type Origin = { origin: 'engine' | 'unsafe'; tag?: string }
const originStore = new AsyncLocalStorage<Origin>()
type Seen = { kind: string; origin: string | null; tag?: string; scope: string }
let seen: Seen[] = []
let throwMode = false
let throwOnKind: string | null = null
class UnstampedQueryError extends Error {}
const tripwire: SqlMiddleware = {
  name: 'opensaas-tripwire',
  familyId: 'sql',
  async beforeCompile(draft: any, ctx: any) {
    const o = originStore.getStore()
    seen.push({ kind: draft.ast.kind, origin: o?.origin ?? null, tag: o?.tag, scope: ctx.scope })
    if (throwMode && !o)
      throw new UnstampedQueryError(`unstamped ${draft.meta.lane}/${draft.ast.kind}`)
    if (throwOnKind && draft.ast.kind === throwOnKind)
      throw new UnstampedQueryError(`refused ${draft.ast.kind}`)
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
const db: any = postgres({ contract, url: s.url, middleware: [tripwire], verifyMarker: false })
const orm = db.orm.public
const engine = <T>(tag: string, fn: () => Promise<T>) =>
  originStore.run({ origin: 'engine', tag }, async () => await fn())
const engineLazy = <T>(tag: string, fn: () => T) => originStore.run({ origin: 'engine', tag }, fn)
const summary = (label: string) =>
  console.log(
    `${label.padEnd(66)} statements=${seen.length} origin-visible=${seen.filter((x) => x.origin !== null).length}/${seen.length}  ${seen.map((x) => `${x.kind}:${x.origin ?? '-'}${x.tag ? '(' + x.tag + ')' : ''}[${x.scope}]`).join(' ')}`,
  )
async function measure(label: string, fn: () => Promise<unknown>) {
  seen = []
  let err: string | undefined
  try {
    await fn()
  } catch (e: any) {
    err = `${e.constructor?.name}: ${String(e.message).slice(0, 90)}`
  }
  summary(label)
  if (err) console.log(`   -> threw ${err}`)
}

console.log('\n== H. hook-shaped exits, done right (await inside the exit) ==')
throwMode = true
await measure('H1 hook query: als.exit(async () => await all()) inside engine run', () =>
  engine('outer', () => originStore.exit(async () => await orm.Post.all())),
)
await measure('H2 hook returns a LAZY all() the engine then awaits (caveat)', () =>
  engine('outer', async () => await originStore.exit(() => orm.Post.all())),
)
await measure('H3 hook query: exit(async () => await update()) - eager write', () =>
  engine('outer', () =>
    originStore.exit(async () => await orm.Post.where({ id: 'p1' }).update({ title: 'h' })),
  ),
)
await measure('H4 hook returns an un-awaited update() promise, engine awaits it', () =>
  engine(
    'outer',
    async () => await originStore.exit(() => orm.Post.where({ id: 'p1' }).update({ title: 'h2' })),
  ),
)
throwMode = false

console.log(
  '\n== I. laziness survey: terminal called inside run, awaited outside (which terminals execute at call time?) ==',
)
const lazyCases: Array<[string, () => unknown]> = [
  ['all()', () => orm.Post.all()],
  ['first()', () => orm.Post.where({ id: 'p1' }).first()],
  ['aggregate()', () => orm.Post.aggregate((a: any) => ({ n: a.count() }))],
  [
    'create()',
    () => orm.Post.create({ id: `l${Date.now()}`, title: 'l', published: false, authorId: 'u1' }),
  ],
  ['update()', () => orm.Post.where({ id: 'p1' }).update({ title: 'l' })],
  ['updateAll()', () => orm.Post.where({ id: 'p1' }).updateAll({ title: 'l2' })],
  ['delete()', () => orm.Post.where({ id: 'nope' }).delete()],
  ['deleteAll()', () => orm.Post.where({ id: 'nope' }).deleteAll()],
  [
    'upsert()',
    () =>
      orm.Post.upsert({
        where: { id: 'p1' },
        create: { id: 'p1', title: 'u', published: false, authorId: 'u1' },
        update: { title: 'u' },
      }),
  ],
  ['runtime().query(dsl plan)', () => db.runtime().query(db.sql.public.Post.select('id').build())],
  [
    'runtime().execute(raw plan)',
    () =>
      db
        .runtime()
        .execute(
          db.raw.sql`UPDATE "public"."Post" SET "title"="title" WHERE "id"=${'nope'}`
            .affectedCount()
            .build(),
        ),
  ],
]
for (const [label, fn] of lazyCases) {
  seen = []
  const r: any = engineLazy('lazy', fn)
  const beforeAwait = seen.length
  try {
    if (r && typeof r[Symbol.asyncIterator] === 'function' && typeof r.then !== 'function') {
      for await (const _ of r) {
      }
    } else await r
  } catch (e: any) {
    console.log('   err', e.message.slice(0, 80))
  }
  const visible = seen.filter((x) => x.origin !== null).length
  console.log(
    `  ${label.padEnd(30)} compiled-before-await=${beforeAwait} total=${seen.length} origin-visible=${visible}/${seen.length}  -> ${beforeAwait === 0 ? 'LAZY (executes at await)' : 'EAGER (executes at call)'}${visible === seen.length ? '' : '  [would be refused if awaited outside]'}`,
  )
}

console.log(
  '\n== J. a refusal on the SECOND statement of an implicit transaction: rollback and client health ==',
)
{
  await seedPool.query(`update "Post" set title = 'before' where id = 'p2'`)
  throwOnKind = 'update'
  seen = []
  let err = ''
  try {
    await engine('w', () => orm.Post.where({ id: 'p2' }).update({ title: 'after' }))
  } catch (e: any) {
    err = `${e.constructor?.name}: ${e.message.slice(0, 60)}`
  }
  throwOnKind = null
  const row = (await seedPool.query(`select title from "Post" where id = 'p2'`)).rows[0]
  console.log(
    `  statements seen: ${seen.map((x) => x.kind).join(',')}  threw: ${err}  row title after: ${row.title} (expected 'before')`,
  )
  const ok = await engine('r', () => orm.Post.where({ id: 'p2' }).first())
  const inTx = await db.transaction(async (tx: any) =>
    engine('t', () => tx.orm.public.Post.where({ id: 'p2' }).first()),
  )
  console.log(
    `  client still usable: plain first() -> ${ok?.id}, transaction first() -> ${inTx?.id}`,
  )
  console.log(
    `  cause chain: ${(() => {
      let c: any
      try {
        throw new Error()
      } catch (e) {
        c = e
      }
      return ''
    })()}`,
  )
}

console.log('\n== K. tripwire error surfaces to the caller unwrapped? ==')
{
  throwMode = true
  try {
    await orm.Post.all()
  } catch (e: any) {
    let c = e,
      chain = []
    while (c) {
      chain.push(c.constructor?.name)
      c = c.cause
    }
    console.log(
      `  caller sees: ${chain.join(' <- ')}; instanceof UnstampedQueryError: ${e instanceof UnstampedQueryError}`,
    )
  }
  try {
    await orm.Post.where({ id: 'p2' }).update({ title: 'x' })
  } catch (e: any) {
    let c = e,
      chain = []
    while (c) {
      chain.push(c.constructor?.name)
      c = c.cause
    }
    console.log(
      `  update caller sees: ${chain.join(' <- ')}; instanceof: ${e instanceof UnstampedQueryError}`,
    )
  }
  throwMode = false
}

console.log('\n== F. prepare(): beforeCompile once at prepare or per execution? ==')
{
  seen = []
  try {
    const prepared: any = await engine('prep', () =>
      db.prepare({ id: 'pg/text@1' }, (sql: any, params: any) =>
        sql.public.Post.select('id')
          .where((p: any) => p.id.eq(params.id))
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
    throwMode = true
    try {
      await exec()
      summary('  F3 execute prepared, outside any run, tripwire throwing')
    } catch (e: any) {
      console.log('  F3 threw', e.message)
    } finally {
      throwMode = false
    }
    seen = []
    await engine('exec', exec)
    summary('  F4 execute prepared again, inside engine run')
    seen = []
    throwMode = true
    try {
      await db.prepare({ id: 'pg/text@1' }, (sql: any, params: any) =>
        sql.public.Post.select('id')
          .where((p: any) => p.id.eq(params.id))
          .build(),
      )
      summary('  F5 prepare() outside any run, tripwire throwing')
    } catch (e: any) {
      console.log(
        '  F5 prepare() outside any run, tripwire throwing -> threw',
        e.message.slice(0, 80),
      )
    } finally {
      throwMode = false
    }
  } catch (e: any) {
    console.log('  prepare probe failed:', e.constructor?.name, String(e.message).slice(0, 200))
  }
}

await seedPool.end()
await db.close()
await s.stop()
process.exit(0)
