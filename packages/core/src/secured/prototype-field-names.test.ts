import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000
const NAMES = ['constructor', 'toString', 'hasOwnProperty'] as const

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    P: {
      fields: {
        title: text(),
        owner: relationship({ ref: 'Q.items' }),
        constructor: text(),
        toString: text(),
        hasOwnProperty: text(),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
    Q: {
      fields: { name: text(), items: relationship({ ref: 'P.owner', many: true }) },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
  },
}

describe('a declared field named after an Object.prototype member', () => {
  let harness: TestContext
  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'u1' })
  }, BOOT)
  afterAll(async () => {
    await harness?.close()
  })

  test.each(NAMES)('%s creates, reads, selects and filters', async (name) => {
    const data = Object.defineProperty({ title: 't' }, name, {
      value: `v-${name}`,
      enumerable: true,
    })
    const created = await harness.context.db.P.create({ data })
    expect(created).not.toBeNull()
    const all = await harness.context.db.P.all()
    expect(all.length).toBeGreaterThan(0)
    const selected = await harness.context.db.P.where({ id: { equals: created?.id ?? '' } })
      .select(name)
      .all()
    expect(Object.getOwnPropertyDescriptor(selected[0], name)?.value).toBe(`v-${name}`)
    const found = await harness.context.db.P.where({ [name]: { equals: `v-${name}` } }).all()
    expect(found).toHaveLength(1)
    const updated = await harness.context.db.P.update({
      where: { id: created?.id ?? '' },
      data: Object.defineProperty({}, name, { value: 'u', enumerable: true }),
    })
    expect(updated).not.toBeNull()
    const ordered = await harness.context.db.P.orderBy({ [name]: 'asc' }).all()
    expect(ordered.length).toBeGreaterThan(0)
  })

  test('selecting a prototype-named field through an include', async () => {
    const owner = await harness.context.db.Q.create({ data: { name: 'q' } })
    const item = await harness.context.db.P.create({
      data: { title: 't', constructor: 'c', owner: { connect: { id: owner?.id ?? '' } } },
    })
    expect(item).not.toBeNull()
    const rows = await harness.context.db.Q.where({ id: { equals: owner?.id ?? '' } })
      .include('items', (items) => items.select('constructor'))
      .all()
    const included: unknown = rows[0]?.items
    if (!Array.isArray(included)) throw new Error('items were not included')
    expect(included).toHaveLength(1)
    expect(Object.getOwnPropertyDescriptor(included[0], 'constructor')?.value).toBe('c')
  })
})
