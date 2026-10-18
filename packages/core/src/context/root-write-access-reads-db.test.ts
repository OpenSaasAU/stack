import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000
const PROBE = 10_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Permission: {
      fields: { name: text() },
      access: { operation: { query: () => true, create: () => true } },
    },
    Doc: {
      fields: { name: text() },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: async ({ context }) => (await context.db.Permission.first()) !== null,
          delete: async ({ context }) => (await context.db.Permission.first()) !== null,
        },
      },
    },
    Note: {
      fields: { name: text() },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: async ({ context }) => {
            const permission = await context.db.Permission.first()
            return permission === null ? false : { name: { equals: 'before' } }
          },
        },
      },
    },
  },
}

describe('a root update or delete whose access rule reads context.db', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
  })

  async function seed(withPermission: boolean): Promise<string> {
    const admin = database.context(null).sudo()
    if (withPermission) await admin.db.Permission.create({ data: { name: 'p' } })
    const row = await admin.db.Doc.create({ data: { name: 'before' } })
    if (row === null) throw new Error('seed failed')
    return String(row.id)
  }

  test(
    'update completes on the single-connection database',
    async () => {
      const id = await seed(true)
      const result = await database
        .context(null)
        .db.Doc.update({ where: { id }, data: { name: 'after' } })
      expect(result).toMatchObject({ name: 'after' })
    },
    PROBE,
  )

  test(
    'delete completes on the single-connection database',
    async () => {
      const id = await seed(true)
      const result = await database.context(null).db.Doc.delete({ where: { id } })
      expect(result).not.toBeNull()
    },
    PROBE,
  )

  test(
    'a denying rule still returns null and writes nothing',
    async () => {
      const id = await seed(false)
      const ctx = database.context(null)
      expect(await ctx.db.Doc.update({ where: { id }, data: { name: 'after' } })).toBeNull()
      expect(await ctx.db.Doc.delete({ where: { id } })).toBeNull()
      const row = await ctx
        .sudo()
        .db.Doc.where({ id: { equals: id } })
        .first()
      expect(row).toMatchObject({ name: 'before' })
    },
    PROBE,
  )

  test(
    'the rule sees a write made earlier in the joined transaction',
    async () => {
      const id = await seed(false)
      const result = await database.context(null).transaction(async (tx) => {
        await tx.sudo().db.Permission.create({ data: { name: 'p' } })
        return tx.db.Doc.update({ where: { id }, data: { name: 'after' } })
      })
      expect(result).toMatchObject({ name: 'after' })
    },
    PROBE,
  )

  test(
    'a filter-returning rule that reads context.db completes',
    async () => {
      const admin = database.context(null).sudo()
      await admin.db.Permission.create({ data: { name: 'p' } })
      const note = await admin.db.Note.create({ data: { name: 'before' } })
      if (note === null) throw new Error('seed failed')
      const result = await database
        .context(null)
        .db.Note.update({ where: { id: String(note.id) }, data: { name: 'after' } })
      expect(result).toMatchObject({ name: 'after' })
    },
    PROBE,
  )
})
