// FACT B: duck-typed fake pg.Client. Records SQL+params, returns canned rows.
import postgres from '@prisma/orm-postgres/runtime'
import { contract } from './contract.ts'

type Call = { kind: 'query'; text: string; values?: unknown[]; name?: string; hasTypes: boolean } | { kind: string }
const calls: Call[] = []
let canned: { rows: any[]; rowCount: number | null } = { rows: [], rowCount: 0 }

const fakeClient = {
  escapeIdentifier: (s: string) => `"${s}"`,
  escapeLiteral: (s: string) => `'${s}'`,
  on(ev: string, _fn: unknown) { calls.push({ kind: `on(${ev})` }); return this },
  async connect() { calls.push({ kind: 'connect' }) },
  async end() { calls.push({ kind: 'end' }) },
  async query(cfg: any, values?: unknown[]) {
    if (typeof cfg === 'string') calls.push({ kind: 'query', text: cfg, values, hasTypes: false })
    else calls.push({ kind: 'query', text: cfg.text, values: cfg.values, name: cfg.name, hasTypes: 'types' in cfg })
    const text = typeof cfg === 'string' ? cfg : cfg.text
    if (/marker/i.test(text)) { markerSql.push(text); return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] } }
    return { ...canned, command: 'SELECT', oid: 0, fields: [] }
  },
}
const markerSql: string[] = []

const db: any = postgres({ contract, pg: fakeClient as any })
console.log('-- verifyMarker default: first query triggers a marker read through the SAME fake client --')
const dump = (label: string) => { console.log(`\n-- ${label} --`); for (const c of calls) console.log('  ', JSON.stringify(c)); calls.length = 0 }

canned = { rows: [{ id: 'p1', title: 'hi', published: true, authorId: 'u1' }], rowCount: 1 }
const rows = await db.orm.public.Post.where({ authorId: 'u1', published: true }).all()
dump('where().all()  [first query: includes marker read]'); console.log('   marker SQL seen:', JSON.stringify(markerSql))
console.log('   rows ->', JSON.stringify(rows))

canned = { rows: [{ id: 'p9', title: 'new', published: false, authorId: 'u1' }], rowCount: 1 }
const created = await db.orm.public.Post.create({ id: 'p9', title: 'new', published: false, authorId: 'u1' })
dump('create()')
console.log('   created ->', JSON.stringify(created))

canned = { rows: [{ id: 'p9', title: 'new', published: true, authorId: 'u1' }], rowCount: 1 }
const upd = await db.orm.public.Post.where({ id: 'p9' }).update({ published: true })
dump('where().update()')
console.log('   updated ->', JSON.stringify(upd))

canned = { rows: [], rowCount: 1 }
const del = await db.orm.public.Post.where({ id: 'p9' }).delete()
dump('where().delete()')
console.log('   delete ->', JSON.stringify(del))

canned = { rows: [{ id: 'p1', title: 'hi', published: true, authorId: 'u1' }], rowCount: 1 }
const tx = await db.transaction(async (t: any) => t.orm.public.Post.where({ id: 'p1' }).first())
dump('transaction(first)')
console.log('   tx ->', JSON.stringify(tx))

console.log('\n-- decoding: are pg-text values decoded by the runtime? --')
for (const v of [{ published: 't' }, { published: 'true' }, { published: true }, { published: 1 }]) {
  canned = { rows: [{ id: 'p1', title: 'hi', authorId: 'u1', ...v }], rowCount: 1 }
  try {
    const r = await db.orm.public.Post.first()
    console.log(`   row.published=${JSON.stringify(v.published)} -> ${JSON.stringify(r.published)} (${typeof r.published})`)
  } catch (e: any) { console.log(`   row.published=${JSON.stringify(v.published)} -> THROWS ${String(e.message).slice(0, 100)}`) }
}
calls.length = 0
console.log('\n-- extra columns / missing columns --')
canned = { rows: [{ id: 'p1', title: 'hi', published: true, authorId: 'u1', extra: 1 }], rowCount: 1 }
console.log('   extra col ->', JSON.stringify(await db.orm.public.Post.first()))
canned = { rows: [{ id: 'p1' }], rowCount: 1 }
try { console.log('   missing cols ->', JSON.stringify(await db.orm.public.Post.first())) } catch (e: any) { console.log('   missing cols -> THROWS', String(e.message).slice(0, 160)) }
calls.length = 0

console.log('\n-- include (relation) against fake --')
canned = { rows: [{ id: 'u1', name: 'alice', posts: [{ id: 'p1', title: 'hi', published: true, authorId: 'u1' }] }], rowCount: 1 }
try { const r = await db.orm.public.User.include('posts').all(); dump('include'); console.log('   ->', JSON.stringify(r)) } catch (e: any) { dump('include'); console.log('   THROWS', String(e.message).slice(0, 200)) }

console.log('\n-- minimal interface probe: which members did the driver touch? --')
const touched = new Set<string>()
const probe = new Proxy({ escapeIdentifier: () => '', escapeLiteral: () => '' } as any, {
  get(t, k) {
    touched.add(String(k))
    if (k === 'query') return async () => ({ rows: [], rowCount: 0 })
    if (k === 'connect' || k === 'end') return async () => {}
    if (k === 'on') return () => probe
    return t[k]
  },
  has(t, k) { touched.add('has:' + String(k)); return k in t || ['on', 'query', 'connect', 'end'].includes(String(k)) },
})
const db2: any = postgres({ contract, pg: probe })
await db2.orm.public.Post.all(); await db2.orm.public.Post.create({ id: 'x', title: 'x', published: false, authorId: 'u1' }).catch(() => {})
await db2.close()
console.log('   touched:', [...touched].join(', '))
await db.close()
console.log('\n-- verifyMarker: false -> no marker read at all --')
calls.length = 0; markerSql.length = 0
const db3: any = postgres({ contract, pg: fakeClient as any, verifyMarker: false })
canned = { rows: [{ id: 'p1', title: 'hi', published: true, authorId: 'u1' }], rowCount: 1 }
console.log('   rows ->', JSON.stringify(await db3.orm.public.Post.where({ id: 'p1' }).all()))
dump('verifyMarker:false where().all()'); console.log('   marker SQL seen:', JSON.stringify(markerSql))
await db3.close()
