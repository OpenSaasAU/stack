import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Customer: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        orders: relationship({ ref: 'Order.customer', many: true }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            session?.scoped === true ? { name: { equals: 'visible' } } : true,
          create: () => true,
        },
      },
    },
    Order: {
      fields: {
        ref: text({ validation: { isRequired: true } }),
        customer: relationship({ ref: 'Customer.orders' }),
        hidden: relationship({ ref: 'Customer', access: { read: () => false } }),
        peeking: relationship({
          ref: 'Customer',
          access: { read: ({ item }) => item?.peeking === null },
        }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

let database: TestDatabase
let visibleId: string
let secretId: string

beforeAll(async () => {
  database = await createTestDatabase(config)
  const sudo = database.context(null).sudo()
  const visible = await sudo.db.Customer.create({ data: { name: 'visible' } })
  const secret = await sudo.db.Customer.create({ data: { name: 'secret' } })
  if (!visible || !secret) throw new Error('seed customers')
  visibleId = String(visible.id)
  secretId = String(secret.id)
  await sudo.db.Order.create({
    data: {
      ref: 'o-visible',
      customer: { connect: { id: visibleId } },
      hidden: { connect: { id: visibleId } },
      peeking: { connect: { id: visibleId } },
    },
  })
  await sudo.db.Order.create({ data: { ref: 'o-secret', customer: { connect: { id: secretId } } } })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

const nobody = { name: { equals: 'nobody' } } as const

describe("a caller's own where() on a to-one include", () => {
  test("leaves the foreign key as stored when the caller's filter excludes the row", async () => {
    const context = database.context(null)
    const rows = await context.db.Order.where({ ref: { equals: 'o-visible' } })
      .select('ref', 'customerId')
      .include('customer', (customer) => customer.where(nobody))
      .all()
    expect(rows).toMatchObject([{ ref: 'o-visible', customerId: visibleId, customer: null }])
  })

  test('returns both the id and the row when the caller filter matches', async () => {
    const context = database.context(null)
    const rows = await context.db.Order.where({ ref: { equals: 'o-visible' } })
      .select('ref', 'customerId')
      .include('customer', (customer) => customer.where({ name: { equals: 'visible' } }))
      .all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.customerId).toBe(visibleId)
    expect(rows[0]?.customer).toMatchObject({ id: visibleId, name: 'visible' })
  })

  test("nulls the foreign key when the target's query access excludes it, refined or not", async () => {
    const context = database.context({ scoped: true })
    const refined = await context.db.Order.where({ ref: { equals: 'o-secret' } })
      .select('ref', 'customerId')
      .include('customer', (customer) => customer.where({ name: { equals: 'secret' } }))
      .all()
    expect(refined).toMatchObject([{ ref: 'o-secret', customerId: null, customer: null }])

    const plain = await context.db.Order.where({ ref: { equals: 'o-secret' } })
      .select('ref', 'customerId')
      .include('customer')
      .all()
    expect(plain).toMatchObject([{ ref: 'o-secret', customerId: null, customer: null }])
  })

  test('keeps the foreign key of a row the access filter admits under a refinement that excludes it', async () => {
    const context = database.context({ scoped: true })
    const rows = await context.db.Order.where({ ref: { equals: 'o-visible' } })
      .select('ref', 'customerId')
      .include('customer', (customer) => customer.where(nobody))
      .all()
    expect(rows).toMatchObject([{ ref: 'o-visible', customerId: visibleId, customer: null }])
  })

  test('hides the foreign key when the relationship field read is denied', async () => {
    const context = database.context(null)
    const rows = await context.db.Order.where({ ref: { equals: 'o-visible' } })
      .select('ref', 'hiddenId')
      .include('hidden', (hidden) => hidden.where(nobody))
      .all()
    expect(rows[0]?.hiddenId ?? null).toBeNull()
  })

  test("does not let the caller's filter satisfy a row-dependent read rule on the relation", async () => {
    const context = database.context(null)
    const rows = await context.db.Order.where({ ref: { equals: 'o-visible' } })
      .select('ref', 'peekingId')
      .include('peeking', (peeking) => peeking.where(nobody))
      .all()
    expect(rows[0]?.peekingId ?? null).toBeNull()
  })
})
