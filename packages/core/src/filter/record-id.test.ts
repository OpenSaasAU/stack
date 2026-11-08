import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { checkbox, relationship, text } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { engineContextOf } from '../context/engine-context.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { buildListFilterWhere } from './collect.js'

const BOOT = 120_000

const reader: Session = { role: 'reader' }
const admin: Session = { role: 'admin' }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        hidden: checkbox(),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            String(session?.role ?? '') === 'admin' ? true : { hidden: { equals: false } },
        },
      },
    },
    Tag: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.tag', many: true }),
      },
      access: { operation: { query: () => true } },
      db: { idField: 'cuid2' },
    },
    Owner: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        posts: relationship({ ref: 'Post.owner', many: true }),
      },
      access: { operation: { query: () => true } },
      db: { idField: 'int autoincrement' },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        author: relationship({ ref: 'User.posts' }),
        tag: relationship({ ref: 'Tag.posts' }),
        owner: relationship({ ref: 'Owner.posts' }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase
const ids: Record<string, string> = {}

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

async function whereFor(query: string, session: Session = reader) {
  const context = engineContextOf(database.context(session))
  return buildListFilterWhere(query, config.lists.Post, 'Post', config, {
    session: context.session,
    context,
  })
}

async function titles(query: string, session: Session = reader): Promise<string[]> {
  const where = await whereFor(query, session)
  const read = database.context(session).db.Post
  const rows = await (where ? read.where(where) : read).all()
  return rows.map((row) => String(row.title)).sort()
}

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  const ada = await seed('User', { name: 'Ada', hidden: false })
  const adaReed = await seed('User', { name: 'Ada Reed', hidden: false })
  const ghost = await seed('User', { name: 'Ghost', hidden: true })
  const tag = await seed('Tag', { name: 'Engines' })
  const owner = await seed('Owner', { name: 'Babbage' })
  ids.ada = String(ada.id)
  ids.ghost = String(ghost.id)
  ids.tag = String(tag.id)
  ids.owner = String(owner.id)
  await seed('Post', { title: 'On Engines', authorId: ada.id, tagId: tag.id })
  await seed('Post', { title: 'On Looms', authorId: adaReed.id, ownerId: owner.id })
  await seed('Post', { title: 'On Ghosts', authorId: ghost.id })
  await seed('Post', { title: 'Notes #1' })
})

describe('`field:#id` over the secured surface', () => {
  test(
    'matches exactly the picked record, where its label also matches a similar name',
    async () => {
      expect(await titles('author:Ada')).toEqual(['On Engines', 'On Looms'])
      expect(await titles(`author:#${ids.ada}`)).toEqual(['On Engines'])
    },
    BOOT,
  )

  test(
    'lowers through the relation, never the foreign key column',
    async () => {
      expect(await whereFor(`author:#${ids.ada}`)).toEqual({
        author: { some: { id: { equals: ids.ada } } },
      })
    },
    BOOT,
  )

  test(
    'a record the session cannot read matches nothing',
    async () => {
      expect(await titles(`author:#${ids.ghost}`, admin)).toEqual(['On Ghosts'])
      expect(await titles(`author:#${ids.ghost}`)).toEqual([])
    },
    BOOT,
  )

  test(
    'coerces the id through the contract for uuid7, cuid2 and int autoincrement',
    async () => {
      expect(await titles(`tag:#${ids.tag}`)).toEqual(['On Engines'])
      expect(await titles(`owner:#${ids.owner}`)).toEqual(['On Looms'])
      expect(await whereFor(`owner:#${ids.owner}`)).toEqual({
        owner: { some: { id: { equals: Number(ids.owner) } } },
      })
    },
    BOOT,
  )

  test.each(['author:#1', 'tag:#1', 'owner:#1x', 'owner:#99999999999', 'author:#'])(
    'an id its list cannot hold degrades to free text: %s',
    async (query) => {
      const word = query.slice(query.indexOf(':') + 1)
      expect(await whereFor(query)).toEqual({ title: { contains: word } })
      expect(await titles(query)).toEqual(word === '#1' || word === '#' ? ['Notes #1'] : [])
    },
    BOOT,
  )

  test(
    'a quoted `"#id"` is label text, matched as contains',
    async () => {
      expect(await whereFor(`author:"#${ids.ada}"`)).toEqual({
        author: { some: { name: { contains: `#${ids.ada}` } } },
      })
      expect(await titles(`author:"#${ids.ada}"`)).toEqual([])
    },
    BOOT,
  )
})
