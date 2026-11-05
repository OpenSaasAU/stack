import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { json, select, text } from './index.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }
const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }
const options = [
  { label: 'Gold', value: 'gold' },
  { label: 'Silver', value: 'silver' },
]

function columnNullable(field: FieldConfig): boolean | undefined {
  const descriptor = field.getContractField?.('value', 'Post', config)
  if (descriptor?.kind !== 'column') throw new Error('expected a single column')
  return descriptor.nullable
}

describe('a field reports the nullability its column declares', () => {
  test.each<[string, FieldConfig, boolean]>([
    ['optional text', text(), true],
    ['required text', text({ validation: { isRequired: true } }), false],
    [
      'required text on a nullable column',
      text({ validation: { isRequired: true }, db: { isNullable: true } }),
      true,
    ],
    ['optional text on a NOT NULL column', text({ db: { isNullable: false } }), false],
    ['optional select', select({ options }), true],
    ['required select', select({ options, validation: { isRequired: true } }), false],
    ['select with a default', select({ options, defaultValue: 'gold' }), false],
    [
      'select with a default on a nullable column',
      select({ options, defaultValue: 'gold', db: { isNullable: true } }),
      true,
    ],
    ['native enum select', select({ options, db: { type: 'enum' } }), true],
    ['optional json', json(), true],
    ['required json', json({ validation: { isRequired: true } }), false],
    ['optional json on a NOT NULL column', json({ db: { isNullable: false } }), false],
  ])('%s', (_, field, expected) => {
    expect(field.nullable).toBe(expected)
    expect(columnNullable(field)).toBe(expected)
  })
})

describe('json() refuses a null its column cannot hold', () => {
  test.each(['create', 'update'] as const)('on %s', (operation) => {
    const schema = json({ db: { isNullable: false } }).getZodSchema?.('meta', operation)

    expect(schema?.safeParse(null).error?.issues[0]?.message).toBe('Meta is required')
    expect(schema?.safeParse(undefined).success).toBe(true)
    expect(schema?.safeParse({ a: 1 }).success).toBe(true)
  })

  test('an optional json on a nullable column still takes null', () => {
    expect(json().getZodSchema?.('meta', 'update').safeParse(null).success).toBe(true)
  })
})

describe('clearing to null round-trips through the database', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(
      {
        db: { provider: 'postgresql' },
        lists: {
          Row: {
            fields: {
              slug: text({ isIndexed: 'unique' }),
              meta: json(),
              tier: select({ options, defaultValue: 'gold', db: { isNullable: true } }),
              must: json({ validation: { isRequired: true }, db: { isNullable: true } }),
            },
            access: { operation: OPEN },
          },
        },
      },
      { userId: 'u1' },
    )
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  const seed = async () => {
    const row = await harness.context.db.Row.create({
      data: { slug: crypto.randomUUID(), meta: { a: 1 }, tier: 'silver', must: { b: 2 } },
    })
    if (row === null || typeof row.id !== 'string') throw new Error('seed row was refused')
    return { id: row.id }
  }

  const reread = async (id: string) => {
    const row = await harness.context.db.Row.where({ id: { equals: id } }).first()
    if (row === null) throw new Error('row is gone')
    return row
  }

  test('two rows can both clear a unique optional text', async () => {
    const [first, second] = [await seed(), await seed()]

    await harness.context.db.Row.update({ where: { id: first.id }, data: { slug: null } })
    await harness.context.db.Row.update({ where: { id: second.id }, data: { slug: null } })

    expect((await reread(first.id)).slug).toBeNull()
    expect((await reread(second.id)).slug).toBeNull()
  })

  test('a cleared json reads back null and matches a null filter', async () => {
    const row = await seed()

    await harness.context.db.Row.update({ where: { id: row.id }, data: { meta: null } })

    expect((await reread(row.id)).meta).toBeNull()
    const matching = await harness.context.db.Row.where({
      id: { equals: row.id },
      meta: { equals: null },
    }).all()
    expect(matching).toHaveLength(1)
  })

  test('a cleared select stays null instead of taking its default', async () => {
    const row = await seed()

    await harness.context.db.Row.update({ where: { id: row.id }, data: { tier: null } })
    expect((await reread(row.id)).tier).toBeNull()

    const created = await harness.context.db.Row.create({
      data: { slug: crypto.randomUUID(), tier: null, must: { b: 2 } },
    })
    expect(created?.tier).toBeNull()
  })

  test('a required json refuses null, naming the field', async () => {
    const row = await seed()

    await expect(
      harness.context.db.Row.update({ where: { id: row.id }, data: { must: null } }),
    ).rejects.toMatchObject({ fieldErrors: { must: 'Must is required' } })
    expect((await reread(row.id)).must).toEqual({ b: 2 })
  })
})
