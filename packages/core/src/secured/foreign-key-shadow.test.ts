import { describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text, virtual } from '../fields/index.js'
import { resolveListMembers } from '../members/list-members.js'
import { createTestDatabase } from '../testing/context.js'
import { validateDatabaseConfig } from '../validation/database-config.js'

const BOOT = 120_000
const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const MESSAGE =
  'List "Item": fields.ownerId collides with the foreign-key column "ownerId" that fields.owner ' +
  'derives for its relationship. Rename fields.ownerId, or remove it and read the key through ' +
  'fields.owner.'

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

describe('a computed field named like an owned foreign key (#2445)', () => {
  test('is refused by generate, naming both fields and the fix', () => {
    expect(validateDatabaseConfig(config)).toEqual([
      {
        listKey: 'Item',
        entry: 'fields.ownerId',
        reason: 'foreign-key-column-collision',
        message: MESSAGE,
      },
    ])
  })

  test('is refused by the List member resolver with the same message', () => {
    expect(() => resolveListMembers(config, 'Item')).toThrow(MESSAGE)
  })

  test(
    'refuses a read rather than resolving the name to either member',
    async () => {
      const database = await createTestDatabase(config)
      try {
        const read = async (): Promise<unknown> => database.context({ userId: 'u1' }).db.Item.all()
        await expect(read()).rejects.toThrow(MESSAGE)
      } finally {
        await database.close()
      }
    },
    BOOT,
  )
})
