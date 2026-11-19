// A multi-column field without assembleColumns: its part columns reach a caller
// only where the owning field's own read rule allows it, on every read path and
// every write return (#2473).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import type { FieldAccess, Session } from '../access/types.js'
import { json, relationship, text, virtual } from '../fields/index.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const PARTS = ['avatar_filename', 'avatar_filesize'] as const

function rawParts(access: FieldAccess): FieldConfig {
  const field = json({ access })
  field.getContractField = () => ({
    kind: 'columns',
    columns: [
      { name: PARTS[0], type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: PARTS[1], type: { pack: 'pg', type: 'int' }, nullable: true },
    ],
  })
  field.splitColumns = (_fieldName, value) => {
    const metadata: { filename?: unknown; filesize?: unknown } =
      typeof value === 'object' && value !== null ? value : {}
    return { [PARTS[0]]: metadata.filename ?? null, [PARTS[1]]: metadata.filesize ?? null }
  }
  return field
}

const adminOnly: FieldAccess = { read: ({ session }) => session?.role === 'admin' }

let ruleCalls = 0

const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Card: {
      fields: {
        title: text(),
        avatar: rawParts(adminOnly),
        owner: relationship({ ref: 'Holder.cards' }),
        tag: relationship({ ref: 'Tag' }),
      },
      access: { operation: open },
    },
    Holder: {
      fields: {
        name: text(),
        cards: relationship({ ref: 'Card.owner', many: true }),
        featured: relationship({ ref: 'Card' }),
      },
      access: { operation: open },
    },
    Tag: {
      fields: { name: text() },
      access: { operation: open },
    },
    Declaring: {
      fields: {
        title: text(),
        avatar: rawParts(adminOnly),
        owner: relationship({ ref: 'Holder' }),
        ownerName: virtual({
          type: 'string',
          needs: ['owner'],
          hooks: {
            resolveOutput: ({ item }) => {
              const owner: unknown = item.owner
              return typeof owner === 'object' && owner !== null && 'name' in owner
                ? String(owner.name)
                : 'none'
            },
          },
        }),
      },
      access: { operation: open },
    },
    Unqueryable: {
      fields: { title: text(), avatar: rawParts(adminOnly) },
      access: {
        operation: { ...open, query: ({ session }) => session?.role === 'admin' },
      },
    },
    Sized: {
      fields: {
        title: text(),
        avatar: rawParts({
          read: ({ item }) =>
            typeof item?.avatar_filesize === 'number' && item.avatar_filesize < 100,
        }),
      },
      access: { operation: open },
    },
    Counted: {
      fields: {
        title: text(),
        avatar: rawParts({
          read: ({ session }) => {
            ruleCalls += 1
            return session?.role === 'admin'
          },
        }),
      },
      access: { operation: open },
    },
    Settings: {
      isSingleton: true,
      fields: { title: text(), avatar: rawParts(adminOnly) },
      access: { operation: open },
    },
  },
}

let database: TestDatabase

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('not a to-many')
  return value.filter(isRecord)
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('not a row')
  return value
}

function seed(model: string, row: object): Promise<Record<string, unknown>> {
  const namespace: unknown = Reflect.get(database.client.orm, 'public')
  if (!isRecord(namespace)) throw new Error('no public namespace')
  const target: unknown = Reflect.get(namespace, model)
  if (!isRecord(target)) throw new Error(`no collection "${model}"`)
  const create: unknown = target.create
  if (typeof create !== 'function') throw new Error(`collection "${model}" has no create`)
  return withOrigin('unsafe', async () => record(await create.call(target, row)))
}

const admin: Session = { role: 'admin' }
const member: Session = { role: 'member' }

const PART_VALUES = { avatar_filename: 'ada.png', avatar_filesize: 12 }

function expectHidden(row: unknown): void {
  const shown = record(row)
  expect(shown).not.toHaveProperty('avatar')
  for (const part of PARTS) expect(shown).not.toHaveProperty(part)
}

function expectParts(row: unknown): void {
  expect(record(row)).toMatchObject(PART_VALUES)
}

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(async () => {
  await database.truncate()
  ruleCalls = 0
})

describe('the root of a read', () => {
  test(
    'all() and first() withhold the parts from a denied session and keep them for an allowed one',
    async () => {
      await seed('Card', { title: 'c1', ...PART_VALUES })

      for (const session of [null, member]) {
        const db = database.context(session).db
        const [listed] = await db.Card.all()
        expectHidden(listed)
        expect(listed).toMatchObject({ title: 'c1' })
        expectHidden(await db.Card.first())
      }

      const db = database.context(admin).db
      const [listed] = await db.Card.all()
      expectParts(listed)
      expectParts(await db.Card.first())
    },
    BOOT,
  )

  test(
    '.select() naming the field returns no part to a denied session, as it returns none to an allowed one',
    async () => {
      await seed('Card', { title: 'c1', ...PART_VALUES })

      const [denied] = await database.context(member).db.Card.select('title', 'avatar').all()
      const [allowed] = await database.context(admin).db.Card.select('title', 'avatar').all()

      expectHidden(denied)
      expect(denied).toMatchObject({ title: 'c1' })
      expectHidden(allowed)
      expect(allowed).toMatchObject({ title: 'c1' })
    },
    BOOT,
  )

  test(
    "a predicate naming a part column answers to the owning field's rule",
    async () => {
      await seed('Card', { title: 'c1', ...PART_VALUES })
      const where = { avatar_filename: { equals: 'ada.png' } }

      await expect(database.context(member).db.Card.where(where).all()).rejects.toThrow()
      expect(await database.context(admin).db.Card.where(where).all()).toHaveLength(1)
    },
    BOOT,
  )

  test(
    'forUpdate() re-reads through the same gate',
    async () => {
      await seed('Card', { title: 'c1', ...PART_VALUES })

      const denied = await database.context(member).transaction((tx) =>
        tx.db.Card.where({ title: { equals: 'c1' } })
          .forUpdate()
          .first(),
      )
      const allowed = await database.context(admin).transaction((tx) =>
        tx.db.Card.where({ title: { equals: 'c1' } })
          .forUpdate()
          .first(),
      )

      expectHidden(denied)
      expectParts(allowed)
    },
    BOOT,
  )

  test(
    "a singleton's get() withholds the parts from a denied session",
    async () => {
      await seed('Settings', { id: 1, title: 's', ...PART_VALUES })

      const denied = await database.context(member).db.Settings.get?.()
      const allowed = await database.context(admin).db.Settings.get?.()

      expectHidden(denied)
      expect(denied).toMatchObject({ title: 's' })
      expectParts(allowed)
    },
    BOOT,
  )
})

describe('rows reached through a relation', () => {
  test(
    'an included to-one',
    async () => {
      const card = await seed('Card', { title: 'c1', ...PART_VALUES })
      await seed('Holder', { name: 'h', featuredId: card.id })

      const [denied] = await database.context(member).db.Holder.include('featured').all()
      const [allowed] = await database.context(admin).db.Holder.include('featured').all()

      expectHidden(denied.featured)
      expect(denied.featured).toMatchObject({ title: 'c1' })
      expectParts(allowed.featured)
    },
    BOOT,
  )

  test(
    'an included to-many',
    async () => {
      const holder = await seed('Holder', { name: 'h' })
      await seed('Card', { title: 'c1', ownerId: holder.id, ...PART_VALUES })
      await seed('Card', { title: 'c2', ownerId: holder.id, ...PART_VALUES })

      const [denied] = await database.context(member).db.Holder.include('cards').all()
      const [allowed] = await database.context(admin).db.Holder.include('cards').all()

      expect(records(denied.cards)).toHaveLength(2)
      for (const card of records(denied.cards)) expectHidden(card)
      expect(records(allowed.cards)).toHaveLength(2)
      for (const card of records(allowed.cards)) expectParts(card)
    },
    BOOT,
  )

  test(
    'a Synthetic back-relation',
    async () => {
      const tag = await seed('Tag', { name: 't' })
      await seed('Card', { title: 'c1', tagId: tag.id, ...PART_VALUES })

      const [denied] = await database.context(member).db.Tag.include('from_Card_tag').all()
      const [allowed] = await database.context(admin).db.Tag.include('from_Card_tag').all()

      const [deniedCard] = records(denied.from_Card_tag)
      const [allowedCard] = records(allowed.from_Card_tag)
      expectHidden(deniedCard)
      expect(deniedCard).toMatchObject({ title: 'c1' })
      expectParts(allowedCard)
    },
    BOOT,
  )
})

describe('a write return', () => {
  const data = { avatar: { filename: 'ada.png', filesize: 12 } }

  test(
    'create, update and delete on a list whose return is the written row',
    async () => {
      for (const [session, expectation] of [
        [member, expectHidden],
        [admin, expectParts],
      ] as const) {
        const db = database.context(session).db
        const created = await db.Card.create({ data: { title: 'c1', ...data } })
        expectation(created)
        const id = record(created).id
        expectation(await db.Card.update({ where: { id }, data: { title: 'c2' } }))
        expectation(await db.Card.delete({ where: { id } }))
      }
    },
    BOOT,
  )

  test(
    'create, update and delete on a list whose return is re-read for a declared relation',
    async () => {
      const holder = await seed('Holder', { name: 'h' })
      for (const [session, expectation] of [
        [member, expectHidden],
        [admin, expectParts],
      ] as const) {
        const db = database.context(session).db
        const created = await db.Declaring.create({
          data: { title: 'd1', owner: { connect: { id: holder.id } }, ...data },
        })
        expectation(created)
        expect(created).toMatchObject({ ownerName: 'h' })
        const id = record(created).id
        expectation(await db.Declaring.update({ where: { id }, data: { title: 'd2' } }))
        expectation(await db.Declaring.delete({ where: { id } }))
      }
    },
    BOOT,
  )

  test(
    'a row the session cannot query comes back as its system fields alone',
    async () => {
      const created = await database
        .context(member)
        .db.Unqueryable.create({ data: { title: 'u', ...data } })

      expect(Object.keys(record(created))).toEqual(['id'])
    },
    BOOT,
  )
})

describe('a row-dependent read rule', () => {
  test(
    'decides each row on the same rule view the field would get, parts included',
    async () => {
      await seed('Sized', { title: 'small', avatar_filename: 's.png', avatar_filesize: 12 })
      await seed('Sized', { title: 'large', avatar_filename: 'l.png', avatar_filesize: 500 })

      const rows = await database.context(member).db.Sized.all()
      const byTitle = new Map(rows.map((row) => [row.title, row]))

      expect(byTitle.get('small')).toMatchObject({
        avatar_filename: 's.png',
        avatar_filesize: 12,
      })
      expectHidden(byTitle.get('large'))
    },
    BOOT,
  )
})

describe('rule invocations', () => {
  test(
    "the owning field's rule runs once per row, not once per part",
    async () => {
      await seed('Counted', { title: 'a', ...PART_VALUES })
      await seed('Counted', { title: 'b', ...PART_VALUES })
      await seed('Counted', { title: 'c' })

      const rows = await database.context(member).db.Counted.all()

      expect(rows).toHaveLength(3)
      for (const row of rows) expectHidden(row)
      expect(ruleCalls).toBe(3)
    },
    BOOT,
  )
})
