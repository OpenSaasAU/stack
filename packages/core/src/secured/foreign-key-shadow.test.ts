import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Org: {
      fields: { handle: text() },
      access: { operation: OPEN },
    },
    Item: {
      fields: {
        title: text(),
        owner: relationship({ ref: 'Org', access: { read: () => false } }),
        ownerId: virtual({
          type: 'string',
          hooks: { resolveOutput: ({ value }) => value },
        }),
      },
      access: { operation: OPEN },
    },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
  const sudo = database.context(null).sudo()
  const org = await sudo.db.Org.create({ data: { handle: 'hidden' } })
  if (!org) throw new Error('seed org')
  await sudo.db.Item.create({ data: { title: 'x', owner: { connect: { id: String(org.id) } } } })
}, BOOT)

afterAll(async () => {
  await database?.close()
})

describe('a computed field named like an owned foreign key (#2445)', () => {
  test(
    "does not carry the foreign key past its relationship's read gate",
    async () => {
      const rows = await database.context({ userId: 'u1' }).db.Item.all()
      expect(rows).toHaveLength(1)
      expect(rows[0].ownerId ?? null).toBeNull()
    },
    BOOT,
  )
})
