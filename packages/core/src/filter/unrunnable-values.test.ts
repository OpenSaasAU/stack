import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { bigInt, integer, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import type { OpenSaasConfig } from '../config/types.js'
import { buildListFilterWhere } from './collect.js'
import { FilterTooLongError } from './map.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Item: {
      fields: {
        name: text(),
        a: text(),
        b: text(),
        c: text(),
        d: text(),
        stock: integer(),
        big: bigInt(),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

describe('filter values the database refuses', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, null)
    await harness.context.db.Item.create({ data: { name: 'one', stock: 5, big: 5n } })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  async function read(query: string): Promise<unknown[]> {
    const where = await buildListFilterWhere(query, config.lists.Item, 'Item', config, {
      context: harness.context,
    })
    const scoped = where ? harness.context.db.Item.where(where) : harness.context.db.Item
    return await scoped.all()
  }

  test(
    'an integer outside int4 matches nothing instead of reaching the database',
    async () => {
      expect(await read('stock:3000000000')).toEqual([])
      expect(await read('stock:>3000000000')).toEqual([])
    },
    BOOT,
  )

  test(
    'a bigInt outside int8 matches nothing instead of reaching the database',
    async () => {
      expect(await read('big:99999999999999999999')).toEqual([])
    },
    BOOT,
  )

  test(
    'a NUL byte in a text value matches nothing instead of failing the read',
    async () => {
      expect(await read('name:%00')).toBeDefined()
      expect(await read('name:a\u0000b')).toEqual([])
      expect(await read('a\u0000b')).toEqual([])
    },
    BOOT,
  )

  test(
    'a search too long to run is refused by name, not by the where limit',
    async () => {
      const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ')
      await expect(read(words)).rejects.toBeInstanceOf(FilterTooLongError)
      const values = Array.from({ length: 300 }, (_, index) => `v${index}`).join(',')
      await expect(read(`name:${values}`)).rejects.toBeInstanceOf(FilterTooLongError)
    },
    BOOT,
  )
})
