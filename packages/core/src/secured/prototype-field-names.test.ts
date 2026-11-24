import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000
const NAMES = ['constructor', 'toString', 'hasOwnProperty'] as const

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    P: {
      fields: {
        title: text(),
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
})
