import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { password, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: {
      fields: {
        name: text(),
        secret: text({ access: { read: () => false } }),
        pw: password(),
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

describe('delete runs the Field Visibility pass', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test(
    'a deleted row omits read-denied fields and the raw password hash',
    async () => {
      const created = await harness.context.sudo().db.User.create({
        data: { name: 'three', secret: 's3', pw: 'hunter2hunter2' },
      })
      const deleted = await harness.context.db.User.delete({ where: { id: String(created?.id) } })

      expect(deleted).toMatchObject({ name: 'three' })
      expect(deleted).not.toHaveProperty('secret')
      expect(JSON.stringify(deleted)).not.toContain('$2')
    },
    BOOT,
  )
})
