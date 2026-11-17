import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { json, relationship, text } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const queried = { Profile: 0, Org: 0 }

function mediaField(): FieldConfig {
  const field = json()
  const columns = ['media_name', 'media_size']
  field.getContractField = () => ({
    kind: 'columns',
    columns: [
      { name: columns[0], type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: columns[1], type: { pack: 'pg', type: 'int' }, nullable: true },
    ],
  })
  field.getColumnNames = () => columns
  field.assembleColumns = (_fieldName, row) => ({ name: row[columns[0]], size: row[columns[1]] })
  field.splitColumns = (_fieldName, value) => {
    const media = (value ?? null) as { name?: string; size?: number } | null
    return { [columns[0]]: media?.name ?? null, [columns[1]]: media?.size ?? null }
  }
  return field
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text(),
        profile: relationship({ ref: 'Profile.user' }),
      },
      access: { operation: OPEN },
    },
    Profile: {
      fields: {
        bio: text(),
        user: relationship({ ref: 'User.profile', db: { foreignKey: true } }),
      },
      access: {
        operation: {
          ...OPEN,
          query: () => {
            queried.Profile += 1
            return true
          },
        },
      },
    },
    Org: {
      fields: { handle: text() },
      access: {
        operation: {
          ...OPEN,
          query: ({ session }) => {
            queried.Org += 1
            return session?.scoped === true ? { handle: { equals: 'mine' } } : true
          },
        },
      },
    },
    Item: {
      fields: {
        title: text(),
        owner: relationship({ ref: 'Org' }),
        media: mediaField(),
      },
      access: { operation: OPEN },
    },
    Note: {
      fields: { title: text() },
      access: { operation: OPEN },
    },
  },
}

const UNQUERYABLE = (list: string, key: string): RegExp =>
  new RegExp(`Cannot query "${list}" — "${key}" is not a queryable field of this list`)

let database: TestDatabase
const open: Session = { userId: 'u1' }
const scoped: Session = { userId: 'u1', scoped: true }

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  const sudo = database.context(null).sudo()
  const mine = await sudo.db.Org.create({ data: { handle: 'mine' } })
  const theirs = await sudo.db.Org.create({ data: { handle: 'theirs' } })
  if (!mine || !theirs) throw new Error('seed orgs')
  for (const [title, org] of [
    ['a', mine],
    ['b', mine],
    ['c', theirs],
  ] as const) {
    await sudo.db.Item.create({
      data: {
        title,
        owner: { connect: { id: String(org.id) } },
        media: { name: `${title}.png`, size: title.charCodeAt(0) },
      },
    })
  }
  await sudo.db.Note.create({ data: { title: 'n' } })
  queried.Profile = 0
  queried.Org = 0
})

describe('a foreign-key name on the side of a one-to-one that does not own it (#2388)', () => {
  test(
    'select() refuses it, as where() and orderBy() do',
    async () => {
      const db = database.context(open).db
      await expect(db.User.select('profileId').all()).rejects.toThrow(
        UNQUERYABLE('User', 'profileId'),
      )
      await expect(db.User.where({ profileId: { equals: 'x' } }).all()).rejects.toThrow(
        UNQUERYABLE('User', 'profileId'),
      )
      await expect(db.User.orderBy({ profileId: 'asc' }).all()).rejects.toThrow(
        UNQUERYABLE('User', 'profileId'),
      )
      await expect(db.User.distinct('profileId').all()).rejects.toThrow(
        UNQUERYABLE('User', 'profileId'),
      )
    },
    BOOT,
  )

  test(
    "is refused at key validation, before the related list's query rule runs",
    async () => {
      const db = database.context(open).db
      await expect(db.User.where({ profileId: { equals: 'x' } }).all()).rejects.toThrow(
        ValidationError,
      )
      await expect(db.User.orderBy({ profileId: 'asc' }).all()).rejects.toThrow(ValidationError)
      expect(queried.Profile).toBe(0)
    },
    BOOT,
  )

  test(
    'the owning side keeps its foreign key in every position',
    async () => {
      const db = database.context(open).db
      await expect(db.Profile.select('userId').all()).resolves.toEqual([])
      await expect(db.Profile.where({ userId: { equals: null } }).all()).resolves.toEqual([])
      await expect(db.Profile.distinct('userId').all()).resolves.toEqual([])
    },
    BOOT,
  )
})

describe('distinct on a foreign key the list owns (#2389)', () => {
  test(
    'distinct and distinctOn accept it',
    async () => {
      const db = database.context(open).db
      const distinct = await db.Item.distinct('ownerId').all()
      expect(distinct).toHaveLength(2)
      const distinctOn = await db.Item.orderBy({ ownerId: 'asc' }).distinctOn('ownerId').all()
      expect(distinctOn).toHaveLength(2)
    },
    BOOT,
  )

  test(
    'is refused while the related list scopes reads, as orderBy is',
    async () => {
      const db = database.context(scoped).db
      await expect(db.Item.distinct('ownerId').all()).rejects.toThrow(
        UNQUERYABLE('Item', 'ownerId'),
      )
      await expect(db.Item.orderBy({ ownerId: 'asc' }).all()).rejects.toThrow(
        UNQUERYABLE('Item', 'ownerId'),
      )
    },
    BOOT,
  )
})

describe('an undeclared createdAt/updatedAt on a list with timestamps off (#2390)', () => {
  test.each(['createdAt', 'updatedAt'])(
    '%s is refused as an unknown name at every read position',
    async (key) => {
      const db = database.context(open).db
      await expect(db.Note.where({ [key]: { equals: null } }).all()).rejects.toThrow(
        UNQUERYABLE('Note', key),
      )
      await expect(db.Note.orderBy({ [key]: 'asc' }).all()).rejects.toThrow(
        UNQUERYABLE('Note', key),
      )
      await expect(db.Note.select(key).all()).rejects.toThrow(UNQUERYABLE('Note', key))
      await expect(db.Note.distinct(key).all()).rejects.toThrow(UNQUERYABLE('Note', key))
      await expect(db.Note.include(key).all()).rejects.toThrow(UNQUERYABLE('Note', key))
    },
    BOOT,
  )

  test.each(['createdAt', 'updatedAt'])(
    '%s in a create or update payload is refused as unknown, not as system-managed',
    async (key) => {
      const context = database.context(open)
      const unknown = new RegExp(`Cannot (create|update) "${key}": it is not a field of this list`)
      await expect(
        context.db.Note.create({ data: { title: 't', [key]: new Date() } }),
      ).rejects.toThrow(unknown)
      await expect(
        context.sudo().db.Note.create({ data: { title: 't', [key]: new Date() } }),
      ).rejects.toThrow(unknown)
      const note = await context.db.Note.where({}).first()
      await expect(
        context.db.Note.update({ where: { id: String(note?.id) }, data: { [key]: new Date() } }),
      ).rejects.toThrow(unknown)
    },
    BOOT,
  )

  test(
    'id stays a system field everywhere',
    async () => {
      const db = database.context(open).db
      const rows = await db.Note.select('id').orderBy({ id: 'asc' }).where({ id: { not: null } }).all()
      expect(rows).toHaveLength(1)
      await expect(db.Note.create({ data: { title: 't', id: 'x' } })).rejects.toThrow(
        /"id": it is system-managed/,
      )
    },
    BOOT,
  )
})

describe('a part column of a multi-column field', () => {
  test(
    'filters and orders',
    async () => {
      const db = database.context(open).db
      const rows = await db.Item.where({ media_name: { contains: '.png' } })
        .orderBy({ media_name: 'desc' })
        .all()
      expect(rows.map((row) => row.title)).toEqual(['c', 'b', 'a'])
    },
    BOOT,
  )

  test(
    'is refused in select and distinct',
    async () => {
      const db = database.context(open).db
      await expect(db.Item.select('media_name').all()).rejects.toThrow(
        UNQUERYABLE('Item', 'media_name'),
      )
      await expect(db.Item.distinct('media_name').all()).rejects.toThrow(
        UNQUERYABLE('Item', 'media_name'),
      )
      await expect(db.Item.include('media_name').all()).rejects.toThrow(
        UNQUERYABLE('Item', 'media_name'),
      )
    },
    BOOT,
  )

  test(
    "the field's own name is not a column to filter, order or distinct by",
    async () => {
      const db = database.context(open).db
      await expect(db.Item.where({ media: { equals: null } }).all()).rejects.toThrow(
        UNQUERYABLE('Item', 'media'),
      )
      await expect(db.Item.orderBy({ media: 'asc' }).all()).rejects.toThrow(
        UNQUERYABLE('Item', 'media'),
      )
      await expect(db.Item.distinct('media').all()).rejects.toThrow(UNQUERYABLE('Item', 'media'))
      const rows = await db.Item.select('media').orderBy({ title: 'asc' }).all()
      expect(rows[0].media).toEqual({ name: 'a.png', size: 97 })
    },
    BOOT,
  )
})

describe('a Synthetic back-relation', () => {
  test(
    'is includable',
    async () => {
      const db = database.context(open).db
      const orgs = await db.Org.orderBy({ handle: 'asc' }).include('from_Item_owner').all()
      expect(orgs.map((org) => (org.from_Item_owner as unknown[]).length)).toEqual([2, 1])
    },
    BOOT,
  )

  test(
    'is refused everywhere else, before any query rule runs for it',
    async () => {
      const db = database.context(open).db
      const key = 'from_Item_owner'
      await expect(db.Org.where({ [key]: { some: {} } }).all()).rejects.toThrow(
        UNQUERYABLE('Org', key),
      )
      await expect(db.Org.orderBy({ [key]: 'asc' }).all()).rejects.toThrow(UNQUERYABLE('Org', key))
      await expect(db.Org.select(key).all()).rejects.toThrow(UNQUERYABLE('Org', key))
      await expect(db.Org.distinct(key).all()).rejects.toThrow(UNQUERYABLE('Org', key))
    },
    BOOT,
  )
})

describe('a relationship', () => {
  test(
    'is filtered through the relation predicates, included, and refused in select, orderBy and distinct',
    async () => {
      const db = database.context(open).db
      const rows = await db.Item.where({ owner: { some: { handle: { equals: 'theirs' } } } })
        .include('owner')
        .all()
      expect(rows.map((row) => row.title)).toEqual(['c'])
      await expect(db.Item.select('owner').all()).rejects.toThrow(/include\("owner"\)/)
      await expect(db.Item.orderBy({ owner: 'asc' }).all()).rejects.toThrow(
        /orderBy takes scalar columns only/,
      )
      await expect(db.Item.distinct('owner').all()).rejects.toThrow(
        /distinct takes scalar columns only/,
      )
    },
    BOOT,
  )

  test(
    'an unknown name is refused, and a scalar is not includable',
    async () => {
      const db = database.context(open).db
      await expect(db.Item.where({ nope: { equals: 1 } }).all()).rejects.toThrow(
        UNQUERYABLE('Item', 'nope'),
      )
      await expect(db.Item.include('title').all()).rejects.toThrow(UNQUERYABLE('Item', 'title'))
      await expect(db.Item.include('ownerId').all()).rejects.toThrow(
        UNQUERYABLE('Item', 'ownerId'),
      )
    },
    BOOT,
  )
})
