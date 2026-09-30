import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { checkbox, relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Org: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        items: relationship({ ref: 'Item.sponsor', many: true }),
      },
      access: { operation: { query: () => true } },
    },
    Item: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        isPrivate: checkbox(),
        sponsor: relationship({
          ref: 'Org.items',
          access: { read: ({ item }) => item?.isPrivate !== true },
        }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
  const sudo = database.context(null).sudo()
  const org = await sudo.db.Org.create({ data: { name: 'others' } })
  if (!org) throw new Error('seed org')
  await sudo.db.Item.create({
    data: { title: 'hidden', isPrivate: true, sponsor: { connect: { id: String(org.id) } } },
  })
}, 120_000)

afterAll(async () => {
  await database.close()
})

describe('select of a foreign key whose relationship read rule reads another column', () => {
  test('a deny-list rule answers the same as the full-row read', async () => {
    const context = database.context(null)
    const full = await context.db.Item.where({ title: { equals: 'hidden' } }).first()
    const projected = await context.db.Item.where({ title: { equals: 'hidden' } })
      .select('sponsorId')
      .first()
    expect(full?.sponsorId).toBeNull()
    expect(projected?.sponsorId).toBeNull()
  })
})
