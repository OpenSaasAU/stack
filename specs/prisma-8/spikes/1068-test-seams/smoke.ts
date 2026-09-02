import postgres from '@prisma/orm-postgres/runtime'
import pg from 'pg'
import { contract, DDL } from './contract.ts'
import { startPglite } from './pglite-server.ts'

const s = await startPglite({ mode: 'tcp' })
console.log('started', s.ms, s.url)
const pool = new pg.Pool({ connectionString: s.url, max: 1 })
await pool.query(DDL)
const db: any = postgres({ contract, pg: pool })
console.log('orm keys', Object.keys(db.orm), Object.keys(db.orm.public ?? {}))
await db.orm.public.User.create({ id: 'u1', name: 'alice' })
const p = await db.orm.public.Post.create({
  id: 'p1',
  title: 'hi',
  published: false,
  authorId: 'u1',
})
console.log('create ->', p)
console.log('all ->', await db.orm.public.Post.where({ authorId: 'u1' }).all())
console.log('update ->', await db.orm.public.Post.where({ id: 'p1' }).update({ published: true }))
console.log(
  'tx ->',
  await db.transaction(async (tx: any) => {
    await tx.orm.public.Post.create({ id: 'p2', title: 'tx', published: true, authorId: 'u1' })
    return tx.orm.public.Post.all()
  }),
)
console.log('include ->', await db.orm.public.User.include('posts').all())
await db.close()
await pool.end()
await s.stop()
