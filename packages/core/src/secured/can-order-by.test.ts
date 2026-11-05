import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { ContractFieldDescriptor, FieldConfig, OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { engineContextOf } from '../context/engine-context.js'
import {
  bigInt,
  calendarDay,
  checkbox,
  decimal,
  integer,
  json,
  password,
  relationship,
  select,
  text,
  timestamp,
  virtual,
} from '../fields/index.js'
import { ValidationError } from '../hooks/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const textColumn = (name: string): ContractFieldDescriptor => ({
  kind: 'column',
  name,
  type: { pack: 'pg', type: 'text' },
  nullable: true,
})

const jsonbColumn = (name: string): ContractFieldDescriptor => ({
  kind: 'column',
  name,
  type: { pack: 'pg', type: 'jsonb' },
  nullable: true,
})

const addressField: FieldConfig = {
  type: 'address',
  outputType: 'string',
  inputType: 'string',
  getColumnNames: () => ['address_line', 'address_city'],
  assembleColumns: (_name, row) => row.address_line,
  splitColumns: (_name, value) => ({ address_line: value, address_city: null }),
  getContractField: () => ({
    kind: 'columns',
    columns: [
      { name: 'address_line', type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: 'address_city', type: { pack: 'pg', type: 'text' }, nullable: true },
    ],
  }),
}

const moneyField: FieldConfig = {
  type: 'money',
  outputType: 'string',
  inputType: 'string',
  getColumnNames: (name) => [name, `${name}_currency`],
  assembleColumns: (name, row) => row[name],
  splitColumns: (name, value) => ({ [name]: value, [`${name}_currency`]: null }),
  getContractField: (name) => ({
    kind: 'columns',
    columns: [
      { name, type: { pack: 'pg', type: 'text' }, nullable: true },
      { name: `${name}_currency`, type: { pack: 'pg', type: 'text' }, nullable: true },
    ],
  }),
}

let readRuleThrows = false
let readRuleCalls = 0

function readRule(): boolean {
  readRuleCalls += 1
  if (readRuleThrows) throw new Error('read rule failed')
  return true
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Bare: {
      fields: {
        title: text(),
        price: moneyField,
        person: relationship({ ref: 'Person.bare' }),
      },
      access: { operation: { query: () => true } },
    },
    Person: {
      fields: { name: text(), bare: relationship({ ref: 'Bare.person' }) },
      access: { operation: { query: () => true } },
    },
    Audited: {
      fields: {
        title: text(),
        createdAt: text({ access: { read: () => false } }),
      },
      access: { operation: { query: () => true } },
    },
    Scoped: {
      fields: { name: text(), records: relationship({ ref: 'Record.scoped', many: true }) },
      access: { operation: { query: () => ({ name: { equals: 'visible' } }) } },
    },
    Gated: {
      fields: { title: text({ access: { read: readRule } }) },
      access: { operation: { query: ({ session }) => session !== null } },
    },
    Owner: {
      fields: {
        name: text(),
        records: relationship({ ref: 'Record.owner', many: true }),
        hiddenRecords: relationship({ ref: 'Record.hiddenOwner', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Record: {
      fields: {
        title: text(),
        rank: integer(),
        huge: bigInt(),
        price: decimal(),
        seenAt: timestamp(),
        born: calendarDay(),
        status: select({ options: [{ label: 'One', value: 'one' }] }),
        slug: { type: 'slug', getContractField: textColumn },
        active: checkbox(),
        meta: json(),
        secret: password(),
        payload: { type: 'payload', getContractField: jsonbColumn },
        address: addressField,
        computed: virtual({ type: 'string', hooks: { resolveOutput: () => 'computed' } }),
        restricted: text({ access: { read: () => false } }),
        owner: relationship({ ref: 'Owner.records' }),
        hiddenOwner: relationship({
          ref: 'Owner.hiddenRecords',
          access: { read: () => false },
        }),
        scoped: relationship({ ref: 'Scoped.records' }),
      },
      db: { timestamps: true },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase

function engineContext(): AccessContext {
  return engineContextOf(database.context(null))
}

async function canOrderBy(
  context: AccessContext,
  listKey: string,
  key: string,
): Promise<boolean | undefined> {
  return (await context._orderableKeys?.(listKey, [key]))?.has(key)
}

function canOrder(context: AccessContext, key: string): Promise<boolean | undefined> {
  return canOrderBy(context, 'Record', key)
}

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

describe('canOrderBy', () => {
  test.each([
    'title',
    'rank',
    'huge',
    'price',
    'seenAt',
    'born',
    'status',
    'slug',
    'id',
    'createdAt',
    'updatedAt',
    'ownerId',
  ])(
    '%s has an order, and a read ordered by it runs',
    async (key) => {
      const context = engineContext()
      expect(await canOrder(context, key)).toBe(true)
      await expect(context.db.Record.orderBy({ [key]: 'desc' }).all()).resolves.toEqual([])
    },
    BOOT,
  )

  test.each([
    ['a boolean column', 'active'],
    ['a json column', 'meta'],
    ['a third-party jsonb column', 'payload'],
    ['a password', 'secret'],
    ['a multi-column field', 'address'],
    ['a virtual field', 'computed'],
    ['a to-one relationship', 'owner'],
    ['a field the session cannot read', 'restricted'],
    ['the foreign key of a relationship the session cannot read', 'hiddenOwnerId'],
    ['the foreign key of a list whose query access is a filter', 'scopedId'],
    ['an unknown field', 'nope'],
    ['an inherited object member', 'constructor'],
    ['the prototype accessor', '__proto__'],
  ])(
    '%s has none, and a read ordered by it is refused as a ValidationError',
    async (_label, key) => {
      const context = engineContext()
      expect(await canOrder(context, key)).toBe(false)
      await expect(context.db.Record.orderBy({ [key]: 'asc' }).all()).rejects.toBeInstanceOf(
        ValidationError,
      )
    },
    BOOT,
  )

  test(
    'a to-many relationship has none',
    async () => {
      expect(await canOrderBy(engineContext(), 'Owner', 'records')).toBe(false)
    },
    BOOT,
  )

  test(
    'a part column of a multi-column field is ordered as the column it is',
    async () => {
      const context = engineContext()
      expect(await canOrder(context, 'address_line')).toBe(true)
      await expect(context.db.Record.orderBy({ address_line: 'asc' }).all()).resolves.toEqual([])
    },
    BOOT,
  )

  test(
    'sudo lifts the read gate and nothing else',
    async () => {
      const context = engineContextOf(database.context(null).sudo())
      expect(await canOrder(context, 'restricted')).toBe(true)
      expect(await canOrder(context, 'active')).toBe(false)
      expect(await canOrder(context, 'secret')).toBe(false)
    },
    BOOT,
  )

  test(
    'a list the config does not declare has no order',
    async () => {
      expect(await canOrderBy(engineContext(), 'Nope', 'title')).toBe(false)
      expect(await canOrderBy(engineContext(), 'constructor', 'title')).toBe(false)
    },
    BOOT,
  )

  test.each([
    ['a timestamp the list does not have', 'Bare', 'createdAt'],
    ['the other timestamp', 'Bare', 'updatedAt'],
    ['the inverse side of a one-to-one', 'Person', 'bareId'],
  ])(
    '%s resolves but names no model field, so it has none',
    async (_label, listKey, key) => {
      const context = engineContext()
      expect(await canOrderBy(context, listKey, key)).toBe(false)
      await expect(context.db[listKey].orderBy({ [key]: 'asc' }).all()).rejects.toBeInstanceOf(
        ValidationError,
      )
      await expect(
        context.db[listKey].where({ [key]: { equals: 'x' } }).all(),
      ).rejects.toBeInstanceOf(ValidationError)
    },
    BOOT,
  )

  test(
    'a read-denied createdAt answers exactly as an absent one does',
    async () => {
      const context = engineContext()
      expect(await canOrderBy(context, 'Audited', 'createdAt')).toBe(false)
      expect(await canOrderBy(context, 'Bare', 'createdAt')).toBe(false)
      const message = (read: PromiseLike<unknown>) =>
        Promise.resolve(read).then(
          () => 'resolved',
          (error: Error) => error.message.replace(/"(Audited|Bare)"/, '"List"'),
        )
      expect(await message(context.db.Audited.orderBy({ createdAt: 'asc' }).all())).toBe(
        await message(context.db.Bare.orderBy({ createdAt: 'asc' }).all()),
      )
    },
    BOOT,
  )

  test(
    'a multi-column field with a part named after it orders by that part',
    async () => {
      const context = engineContext()
      expect(await canOrderBy(context, 'Bare', 'price')).toBe(true)
      await expect(context.db.Bare.orderBy({ price: 'asc' }).all()).resolves.toEqual([])
    },
    BOOT,
  )

  test(
    'a session denied query has no order, and no field rule is asked',
    async () => {
      readRuleCalls = 0
      const context = engineContext()
      expect(await context._orderableKeys?.('Gated', ['title'])).toEqual(new Set())
      await expect(context.db.Gated.all()).resolves.toEqual([])
      expect(readRuleCalls).toBe(0)
    },
    BOOT,
  )

  test(
    'a read rule that throws is a no, not a throw',
    async () => {
      readRuleThrows = true
      try {
        const context = engineContextOf(database.context({ role: 'editor' }))
        expect(await context._orderableKeys?.('Gated', ['title'])).toEqual(new Set())
      } finally {
        readRuleThrows = false
      }
    },
    BOOT,
  )

  test(
    'answers for several keys at once',
    async () => {
      const answer = await engineContext()._orderableKeys?.('Record', [
        'title',
        'active',
        'rank',
        'title',
      ])
      expect(answer).toEqual(new Set(['title', 'rank']))
    },
    BOOT,
  )
})
