import { describe, it, expect } from 'vitest'
import { admin } from 'better-auth/plugins'
import { config as defineConfig } from '@opensaas/stack-core'
import { createTestDatabase } from '@opensaas/stack-core/testing'
import { authPlugin } from '../src/config/plugin.js'

/**
 * Live proof, over the real Test context (`createTestContext`/
 * `createTestDatabase`, ADR-0057), that the ADR-0073 write-deny does not
 * collide with `applyCreateDefaults` (core, issue #615): `User.emailVerified`
 * carries both a fixed `create: () => false` (this field is `input: false`)
 * and a `defaultValue: false` — every non-sudo `context.db.User.create()`
 * omitting it must still succeed and persist `false`, the value Postgres's
 * own `@default(false)` would have produced anyway. Caught in review of
 * PR #1672: before the fix, `applyCreateDefaults` filled `emailVerified` into
 * the payload for every omitted create, and the field-level deny then
 * rejected that filled-in value, making `context.db.User.create()` throw
 * unconditionally for every session, on every app using `authPlugin()`.
 */
describe('input:false write-deny does not break an omitted-field create (issue #1618)', () => {
  it('creates a User omitting emailVerified/role/banned, still denies an explicit attempt to set them', async () => {
    const config = await defineConfig({
      plugins: [
        authPlugin({
          betterAuthPlugins: [admin()],
          access: {
            user: { operation: { query: () => true, create: () => true, update: () => true } },
          },
        }),
      ],
      db: { provider: 'postgresql' },
      lists: {},
    })

    const database = await createTestDatabase(config)
    const context = database.context()

    try {
      const user = await context.db.User.create({
        data: { name: 'Alice', email: 'alice@example.com' },
      })
      expect(user).not.toBeNull()
      expect(user?.emailVerified).toBe(false)
      expect(user?.role).toBeNull()
      expect(user?.banned).toBe(false)

      await expect(
        context.db.User.create({
          data: { name: 'Mallory', email: 'mallory@example.com', emailVerified: true },
        }),
      ).rejects.toThrow(/emailVerified.*field-level access denied/)

      await expect(
        context.db.User.create({
          data: { name: 'Mallory', email: 'mallory2@example.com', role: 'admin' },
        }),
      ).rejects.toThrow(/role.*field-level access denied/)
    } finally {
      await database.close()
    }
  }, 30_000)

  it('sudo can still set the write-denied fields explicitly on create', async () => {
    const config = await defineConfig({
      plugins: [
        authPlugin({
          betterAuthPlugins: [admin()],
          access: { user: { operation: { query: () => true, create: () => true } } },
        }),
      ],
      db: { provider: 'postgresql' },
      lists: {},
    })

    const database = await createTestDatabase(config)
    const context = database.context()

    try {
      const user = await context
        .sudo()
        .db.User.create({ data: { name: 'Admin', email: 'admin@example.com', role: 'admin' } })
      expect(user?.role).toBe('admin')
    } finally {
      await database.close()
    }
  }, 30_000)
})
