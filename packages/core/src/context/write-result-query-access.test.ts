import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Ledger: {
      fields: { note: text(), ownerId: text() },
      access: {
        operation: {
          query: () => false,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
    Doc: {
      fields: { note: text(), ownerId: text() },
      access: {
        operation: {
          query: ({ session }) => ({ ownerId: { equals: String(session?.userId) } }),
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    },
  },
}

describe('a write result respects operation-level query access', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test(
    'create on a list the session cannot query returns only the id, and persists',
    async () => {
      const row = await harness.context.db.Ledger.create({ data: { note: 'n', ownerId: 'u1' } })
      expect(row).not.toBeNull()
      expect(Object.keys(row ?? {})).toEqual(['id'])
      const stored = await harness.context.sudo().db.Ledger.all()
      expect(stored).toHaveLength(1)
    },
    BOOT,
  )

  test(
    'filter rule: own row returns the full row, someone else’s returns system fields only',
    async () => {
      const own = await harness.context.db.Doc.create({ data: { note: 'a', ownerId: 'u1' } })
      expect(own).toMatchObject({ note: 'a', ownerId: 'u1' })
      const other = await harness.context.db.Doc.create({ data: { note: 'b', ownerId: 'u2' } })
      expect(Object.keys(other ?? {})).toEqual(['id'])
    },
    BOOT,
  )

  test(
    'update that moves a row out of scope returns system fields only',
    async () => {
      const own = await harness.context.db.Doc.create({ data: { note: 'c', ownerId: 'u1' } })
      const moved = await harness.context.db.Doc.update({
        where: { id: String(own?.id) },
        data: { ownerId: 'u2' },
      })
      expect(Object.keys(moved ?? {})).toEqual(['id'])
    },
    BOOT,
  )

  test(
    'delete of a row the session could not query returns system fields only',
    async () => {
      const row = await harness.context.sudo().db.Doc.create({ data: { note: 'd', ownerId: 'u2' } })
      const deleted = await harness.context.db.Doc.delete({ where: { id: String(row?.id) } })
      expect(Object.keys(deleted ?? {})).toEqual(['id'])
    },
    BOOT,
  )

  test(
    'sudo returns the full row',
    async () => {
      const row = await harness.context
        .sudo()
        .db.Ledger.create({ data: { note: 'z', ownerId: 'u9' } })
      expect(row).toMatchObject({ note: 'z' })
    },
    BOOT,
  )
})
