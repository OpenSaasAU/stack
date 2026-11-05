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
import { canOrderBy } from './read.js'

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

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
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
      },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase

function engineContext(): AccessContext {
  return engineContextOf(database.context(null))
}

function canOrder(context: AccessContext, key: string): Promise<boolean> {
  return canOrderBy(context, config, 'Record', key)
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
      expect(await canOrderBy(engineContext(), config, 'Owner', 'records')).toBe(false)
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
      expect(await canOrderBy(engineContext(), config, 'Nope', 'title')).toBe(false)
      expect(await canOrderBy(engineContext(), config, 'constructor', 'title')).toBe(false)
    },
    BOOT,
  )
})
