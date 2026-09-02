// FACT D: can a test read a Collection's composed state without executing?
import postgres from '@prisma/orm-postgres/runtime'
import * as ormClient from '@prisma/orm-postgres/orm-client'
import { contract } from './contract.ts'

const db: any = postgres({ contract })  // no binding at all — nothing executes
const q = db.orm.public.Post.where({ authorId: 'u1' }).where((p: any) => p.published.eq(true)).orderBy((p: any) => p.title.asc?.() ?? p.title).limit(5)
console.log('Collection class name:', q.constructor.name, ' instanceof exported Collection:', q instanceof (ormClient as any).Collection)
console.log('own keys:', Object.keys(q))
console.log('state present:', 'state' in q, typeof q.state)
const st = q.state
console.log('state keys:', Object.keys(st))
console.log('filters:', st.filters.length, st.filters.map((f: any) => f.constructor.name))
const rep = (_k: string, v: any) => (v instanceof Map ? Object.fromEntries(v) : v)
console.log('filters JSON:', JSON.stringify(st.filters, rep, 2))
console.log('orderBy:', JSON.stringify(st.orderBy, rep), ' limit:', st.limit, ' offset:', st.offset, ' selectedFields:', st.selectedFields, ' includes:', st.includes.length, ' annotations size:', st.annotations.size)
console.log('immutability: base state filters =', db.orm.public.Post.state.filters.length, ' derived =', q.state.filters.length)
console.log('frozen?', Object.isFrozen(st), Object.isFrozen(q))
console.log('exports of @prisma/orm-postgres/orm-client:', Object.keys(ormClient).join(', '))
// is there a public accessor on the d.mts Collection type? (checked statically in README)
