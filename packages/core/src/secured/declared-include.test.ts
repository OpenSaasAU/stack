import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Person: {
      fields: {
        email: text({ validation: { isRequired: true } }),
        blockedDoc: relationship({ ref: 'Doc.blocked' }),
      },
      access: { operation: { query: () => true, create: () => true, update: () => true } },
    },
    Doc: {
      fields: {
        body: text({
          access: {
            read: ({ item, session }) =>
              Array.isArray(item.blocked) &&
              !item.blocked.some(
                (user: unknown) =>
                  typeof user === 'object' &&
                  user !== null &&
                  'id' in user &&
                  user.id === session?.userId,
              ),
          },
        }),
        blocked: relationship({ ref: 'Person.blockedDoc', many: true }),
        blockedCount: virtual({
          type: 'number',
          needs: ['blocked'],
          hooks: {
            resolveOutput: ({ item }) => (Array.isArray(item.blocked) ? item.blocked.length : -1),
          },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Post: {
      fields: {
        title: text(),
        owner: relationship({ ref: 'Owner.posts', access: { read: () => false } }),
        ownerLabel: virtual({
          type: 'string',
          needs: ['owner'],
          hooks: { resolveOutput: ({ item }) => (item.owner ? 'owned' : 'orphan') },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
    Owner: {
      fields: {
        email: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.owner', many: true }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

describe('a caller-shaped include on a declared dependency', () => {
  let db: TestDatabase
  let blockedId: string
  let aliceId: string

  beforeAll(async () => {
    db = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await db?.close()
  })

  beforeEach(async () => {
    await db.truncate()
    const admin = db.context({}).sudo()
    const doc = await admin.db.Doc.create({ data: { body: 'TOP SECRET' } })
    const blocked = await admin.db.Person.create({
      data: { email: 'blocked@x', blockedDoc: { connect: { id: doc!.id } } },
    })
    const alice = await admin.db.Person.create({ data: { email: 'alice@x' } })
    blockedId = String(blocked!.id)
    aliceId = String(alice!.id)
    const owner = await admin.db.Owner.create({ data: { email: 'admin@x' } })
    await admin.db.Post.create({ data: { title: 'p', owner: { connect: { id: owner!.id } } } })
  })

  test('the baseline hides the body from a blocked user', async () => {
    const [doc] = await db.context({ userId: blockedId }).db.Doc.all()
    expect(doc).not.toHaveProperty('body')
    expect(doc).toMatchObject({ blockedCount: 1 })
  })

  test('a where on the declared relation does not unlock the body', async () => {
    const [doc] = await db
      .context({ userId: blockedId })
      .db.Doc.include('blocked', (blocked) => blocked.where({ id: { equals: aliceId } }))
      .all()
    expect(doc).not.toHaveProperty('body')
    expect(doc).toMatchObject({ blockedCount: 1, blocked: [] })
  })

  test('an offset on the declared relation does not unlock the body', async () => {
    const [doc] = await db
      .context({ userId: blockedId })
      .db.Doc.include('blocked', (blocked) => blocked.offset(50))
      .all()
    expect(doc).not.toHaveProperty('body')
  })

  test('a select on the declared relation does not unlock the body', async () => {
    const [doc] = await db
      .context({ userId: blockedId })
      .db.Doc.include('blocked', (blocked) => blocked.select('email'))
      .all()
    expect(doc).not.toHaveProperty('body')
    expect(doc).toMatchObject({ blockedCount: 1 })
  })

  test('an unblocked user still reads the body under a shaped include', async () => {
    const [doc] = await db
      .context({ userId: aliceId })
      .db.Doc.include('blocked', (blocked) => blocked.where({ id: { equals: aliceId } }))
      .all()
    expect(doc).toMatchObject({ body: 'TOP SECRET', blocked: [], blockedCount: 1 })
  })

  test('a where on a read-denied declared relation does not flip the computed field', async () => {
    const hit = await db
      .context({})
      .db.Post.include('owner', (owner) => owner.where({ email: { equals: 'admin@x' } }))
      .all()
    const miss = await db
      .context({})
      .db.Post.include('owner', (owner) => owner.where({ email: { equals: 'nobody@x' } }))
      .all()
    expect(hit[0]).toMatchObject({ ownerLabel: 'owned' })
    expect(miss[0]).toMatchObject({ ownerLabel: 'owned' })
  })
})
