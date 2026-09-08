import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { HashedPassword, comparePassword, isHashedPassword } from '../utils/password.js'
import { password, text } from './index.js'

/**
 * What a `password()` field puts on a row that comes back through the secured
 * surface: a {@link HashedPassword}, never the digest as a string, and nothing
 * at all once the row is serialised.
 */

const BOOT = 120_000

function schemaConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      User: {
        fields: {
          email: text({ validation: { isRequired: true } }),
          password: password({ validation: { isRequired: true } }),
        },
        access: { operation: { query: () => true, create: () => true, update: () => true } },
      },
    },
  }
}

describe('a password field on a row that comes back', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(schemaConfig(), null)
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  const create = () =>
    harness.context.db.User.create({ data: { email: 'ada@example.com', password: 'secret-1' } })

  test(
    'create wraps it, and the stored value is a hash the plaintext verifies against',
    async () => {
      const created = await create()

      expect(created?.password).toBeInstanceOf(HashedPassword)
      expect(created?.password).not.toBe('secret-1')

      const stored = String((created?.password as HashedPassword).toString())
      expect(isHashedPassword(stored)).toBe(true)
      expect(stored).not.toContain('secret-1')
      expect(await comparePassword('secret-1', stored)).toBe(true)
      expect(await comparePassword('secret-2', stored)).toBe(false)
    },
    BOOT,
  )

  test(
    'a read wraps it the same way, and leaves the other columns as they are',
    async () => {
      await create()

      const [row] = await harness.context.db.User.all()

      expect(row.email).toBe('ada@example.com')
      expect(typeof row.email).toBe('string')
      expect(row.password).toBeInstanceOf(HashedPassword)
    },
    BOOT,
  )

  test(
    'update wraps the new value, and the old hash no longer verifies',
    async () => {
      const created = await create()

      const updated = await harness.context.db.User.update({
        where: { id: String(created?.id) },
        data: { password: 'secret-2' },
      })

      expect(updated?.password).toBeInstanceOf(HashedPassword)
      const stored = String((updated?.password as HashedPassword).toString())
      expect(await comparePassword('secret-2', stored)).toBe(true)
      expect(await comparePassword('secret-1', stored)).toBe(false)
    },
    BOOT,
  )

  test(
    'serialising a row drops the field rather than printing the hash',
    async () => {
      await create()

      const [row] = await harness.context.db.User.all()
      const serialised = JSON.stringify(row)

      expect(serialised).toContain('ada@example.com')
      expect(serialised).not.toContain('$2')
      expect(JSON.parse(serialised).password).toEqual({ isSet: true })
    },
    BOOT,
  )
})
