import { describe, it, expect } from 'vitest'
import { config as defineConfig } from '@opensaas/stack-core'
import { createTestDatabase } from '@opensaas/stack-core/testing'
import { authPlugin } from '../src/config/plugin.js'

describe('credential and identity columns are write-denied under an owner-update rule (issue #2153)', () => {
  it('refuses repointing a session at another user and leaves ownership unchanged', async () => {
    const config = await defineConfig({
      plugins: [
        authPlugin({
          access: {
            user: { operation: { query: () => true } },
            session: {
              operation: {
                query: () => true,
                update: ({ session }) =>
                  session === null ? false : { userId: { equals: session.userId } },
              },
            },
            account: {
              operation: {
                query: () => true,
                update: ({ session }) =>
                  session === null ? false : { userId: { equals: session.userId } },
              },
            },
          },
        }),
      ],
      db: { provider: 'postgresql' },
      lists: {},
    })

    const database = await createTestDatabase(config)
    const root = database.context().sudo()

    try {
      const attacker = await root.db.User.create({ data: { name: 'A', email: 'a@x.io' } })
      const victim = await root.db.User.create({ data: { name: 'V', email: 'v@x.io' } })
      if (attacker === null || victim === null) throw new Error('seed failed')
      const row = await root.db.Session.create({
        data: {
          token: 'tok',
          expiresAt: new Date(Date.now() + 60_000),
          user: { connect: { id: attacker.id } },
        },
      })
      if (row === null) throw new Error('seed failed')

      const context = database.context({ userId: attacker.id })

      await expect(
        context.db.Session.update({
          where: { id: row.id },
          data: { user: { connect: { id: victim.id } } },
        }),
      ).rejects.toThrow(/field-level access denied/)

      await expect(
        context.db.Session.update({ where: { id: row.id }, data: { token: 'stolen' } }),
      ).rejects.toThrow(/field-level access denied/)

      const after = await root.db.Session.where({ id: { equals: row.id } }).first()
      expect(after?.userId).toBe(attacker.id)
    } finally {
      await database.close()
    }
  }, 60_000)
})
