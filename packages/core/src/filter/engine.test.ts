import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { AccessContext, Session } from '../access/types.js'
import { relationship, text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { buildListFilterWhere } from './collect.js'

const BOOT = 120_000

let ada: Session = {}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        author: relationship({ ref: 'User.posts' }),
        // Declares no rule, so `query` is denied by default — the related
        // list a relationship token has to count as empty.
        ledger: relationship({ ref: 'Ledger.posts' }),
      },
      access: { operation: { query: () => true } },
    },
    Ledger: {
      fields: {
        note: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.ledger', many: true }),
      },
    },
  },
}

let database: TestDatabase

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function seed(model: string, row: object): Promise<Record<string, unknown>> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const target: unknown = Reflect.get(namespace, model)
  if (!isRecord(target)) throw new Error(`no collection "${model}"`)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => {
    const created: unknown = await create.call(target, row)
    if (!isRecord(created)) throw new Error('create returned no row')
    return created
  })
}

async function filtered(listKey: string, query: string): Promise<Record<string, unknown>[]> {
  const context = database.context(ada)
  // `getContext` returns the narrower `StackContext` view of the same object
  // the access seam takes as an `AccessContext` — the bridge every other core
  // test over the Test context makes (`access/multi-column-read-write.test.ts`).
  const accessContext = context as unknown as AccessContext
  const where = await buildListFilterWhere(query, config.lists[listKey], listKey, config, {
    session: context.session,
    context: accessContext,
  })
  const read = context.db[listKey]
  return await (where ? read.where(where) : read).all()
}

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  const author = await seed('User', { name: 'Ada' })
  ada = { userId: author.id }
  await seed('User', { name: 'Grace' })
  await seed('Post', { title: 'On Engines', author: author.id })
  await seed('Post', { title: 'On Looms', author: author.id })
  await seed('Ledger', { note: 'private' })
})

describe('the filter engine over the secured surface', () => {
  test(
    'a text token matches case-insensitively: `name:ada` finds `Ada`',
    async () => {
      const rows = await filtered('User', 'name:ada')
      expect(rows.map((row) => row.name)).toEqual(['Ada'])
    },
    BOOT,
  )

  test(
    'a bare free-text word matches case-insensitively too',
    async () => {
      const rows = await filtered('User', 'GRACE')
      expect(rows.map((row) => row.name)).toEqual(['Grace'])
    },
    BOOT,
  )

  test(
    'a to-one label token matches through the relation',
    async () => {
      const rows = await filtered('Post', 'author:ada')
      expect(rows.map((row) => row.title).sort()).toEqual(['On Engines', 'On Looms'])
      expect(await filtered('Post', 'author:grace')).toEqual([])
    },
    BOOT,
  )

  test(
    'a relationship filter over a list the session cannot query returns no rows and no error',
    async () => {
      await expect(filtered('Post', 'ledger:private')).resolves.toEqual([])
    },
    BOOT,
  )

  test(
    'a to-many count token lowers to presence',
    async () => {
      expect((await filtered('User', 'posts:>0')).map((row) => row.name)).toEqual(['Ada'])
      expect((await filtered('User', 'posts:0')).map((row) => row.name)).toEqual(['Grace'])
    },
    BOOT,
  )

  test(
    'any other count comparison degrades to free text rather than breaking the page',
    async () => {
      // `posts:>5` cannot lower — the degraded token is searched as free text
      // over `name`, which matches nothing rather than throwing.
      await expect(filtered('User', 'posts:>5')).resolves.toEqual([])
    },
    BOOT,
  )
})
