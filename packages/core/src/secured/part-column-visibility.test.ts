// A multi-column field without assembleColumns: its part columns reach a caller
// only where the owning field's own read rule allows it, on every read path and
// every write return (#2473).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import type { FieldAccess, Session } from '../access/types.js'
import { json, relationship, text, virtual } from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { createMcpHandlers } from '../mcp/handler.js'
import { withOrigin } from '../origin.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { assertListMembersResolve } from '../members/list-members.js'

const BOOT = 120_000

const unassembled: FieldConfig[] = []

// The runtime refuses a multi-column field without assembleColumns (#2481), so
// the Field Visibility gate is reached the way a field stripped of it after
// validation reaches it: the config resolves whole, then the member goes.
function dropAssemblyAfterResolution(config: OpenSaasConfig): void {
  assertListMembersResolve(config)
  for (const field of unassembled) delete field.assembleColumns
}

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
  field.assembleColumns = (_fieldName, row) => ({ filename: row[PARTS[0]], filesize: row[PARTS[1]] })
  unassembled.push(field)
  return field
}

const adminOnly: FieldAccess = { read: ({ session }) => session?.role === 'admin' }
const memberOnly: FieldAccess = { read: ({ session }) => session?.role === 'member' }

let ruleCalls = 0

const open = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  mcp: { enabled: true, basePath: '/api/mcp' },
  lists: {
    Card: {
      fields: {
        title: text(),
        avatar: rawParts(adminOnly),
        owner: relationship({ ref: 'Holder.cards' }),
        tag: relationship({ ref: 'Tag' }),
        pic: relationship({ ref: 'Pic' }),
      },
      access: { operation: open },
    },
    Pic: {
      fields: { title: text(), avatar: rawParts(memberOnly) },
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
  dropAssemblyAfterResolution(config)
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

      const refused = database.context(member).db.Card.where(where).all()
      await expect(refused).rejects.toBeInstanceOf(ValidationError)
      await expect(refused).rejects.toThrow(
        'Cannot query "Card" — "avatar_filename" is not a queryable field of this list.',
      )
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
  test(
    'a combine rows branch withholds the parts from a denied session and keeps the count',
    async () => {
      const holder = await seed('Holder', { name: 'h' })
      await seed('Card', { title: 'c1', ownerId: holder.id, ...PART_VALUES })
      await seed('Card', { title: 'c2', ownerId: holder.id, ...PART_VALUES })

      for (const [session, expectation] of [
        [null, expectHidden],
        [member, expectHidden],
        [admin, expectParts],
      ] as const) {
        const [read] = await database
          .context(session)
          .db.Holder.include('cards', (cards) =>
            cards.combine({ rows: cards, total: cards.count() }),
          )
          .all()
        const combined = record(read.cards)
        expect(combined.total).toBe(2)
        const rows = records(combined.rows)
        expect(rows).toHaveLength(2)
        for (const card of rows) expectation(card)
      }
    },
    BOOT,
  )

  test(
    'two lists sharing a field name and its part names each follow their own rule in one read',
    async () => {
      const pic = await seed('Pic', { title: 'p1', ...PART_VALUES })
      await seed('Card', { title: 'c1', picId: pic.id, ...PART_VALUES })

      const [asMember] = await database.context(member).db.Card.include('pic').all()
      expectHidden(asMember)
      expectParts(asMember.pic)

      const [asAdmin] = await database.context(admin).db.Card.include('pic').all()
      expectParts(asAdmin)
      expectHidden(asAdmin.pic)
      expect(asAdmin.pic).toMatchObject({ title: 'p1' })
    },
    BOOT,
  )
})

describe('MCP', () => {
  async function call(
    session: Session,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const handlers = createMcpHandlers({
      config,
      getSession: async () => ({ userId: 'user-1', scopes: ['read', 'write'], ...session }),
      getContext: async (given) => database.context(given ?? null),
    })
    const response = await handlers.POST(
      new Request('http://localhost/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      }),
    )
    const body: unknown = JSON.parse(await response.text())
    const result = record(record(body).result)
    const [content] = records(result.content)
    if (result.isError === true) throw new Error(String(content.text))
    const parsed: unknown = JSON.parse(String(content.text))
    return record(parsed)
  }

  test(
    'a query with no fields withholds the parts from a denied session',
    async () => {
      await seed('Card', { title: 'c1', ...PART_VALUES })

      const [denied] = records((await call(member, 'list_card_query', {})).items)
      expectHidden(denied)
      expect(denied).toMatchObject({ title: 'c1' })

      const [allowed] = records((await call(admin, 'list_card_query', {})).items)
      expectParts(allowed)
    },
    BOOT,
  )

  test(
    "a create tool's return withholds the parts from a denied session",
    async () => {
      const denied = await call(member, 'list_card_create', { data: { title: 'c1' } })
      expectHidden(denied.item)
      expect(denied.item).toMatchObject({ title: 'c1' })

      const allowed = await call(admin, 'list_card_create', {
        data: { title: 'c2', avatar: { filename: 'ada.png', filesize: 12 } },
      })
      expectParts(allowed.item)
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

describe('a multi-column field that arrives without assembleColumns', () => {
  test(
    'is refused when the context is built, naming the list, the field and assembleColumns (#2481)',
    async () => {
      const avatar = json({ access: adminOnly })
      avatar.getContractField = () => ({
        kind: 'columns',
        columns: [
          { name: PARTS[0], type: { pack: 'pg', type: 'text' }, nullable: true },
          { name: PARTS[1], type: { pack: 'pg', type: 'int' }, nullable: true },
        ],
      })
      const refused = await createTestDatabase({
        db: { provider: 'postgresql' },
        lists: { Bare: { fields: { title: text(), avatar }, access: { operation: open } } },
      })
      try {
        expect(() => refused.context(admin)).toThrow(
          /"Bare\.avatar".*does not declare assembleColumns\(\)/,
        )
      } finally {
        await refused.close()
      }
    },
    BOOT,
  )
})
