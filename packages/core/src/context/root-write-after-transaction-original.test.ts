import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

let replace: (() => Promise<unknown>) | undefined
let failAfterLock = false
const seen: Record<string, unknown>[] = []

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Doc: {
      fields: { title: text() },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
      hooks: {
        beforeTransaction: async ({ operation, ...rest }) => {
          if (operation === 'delete' && 'item' in rest) {
            seen.push({ hook: 'beforeTransaction', title: rest.item?.title })
          }
          const run = replace
          replace = undefined
          await run?.()
        },
        beforeOperation: async ({ operation, ...rest }) => {
          if (failAfterLock && operation === 'delete') throw new Error('boom')
          if (operation === 'delete' && 'item' in rest)
            seen.push({ hook: 'beforeOperation', title: rest.item?.title })
        },
        afterTransaction: async (args) => {
          if (args.operation === 'delete' || args.operation === 'update') {
            seen.push({ hook: `afterTransaction:${args.status}`, title: args.originalItem?.title })
          }
        },
      },
    },
  },
}

describe('afterTransaction reports the row as resolved under the lock', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    replace = undefined
    failAfterLock = false
    seen.length = 0
  })

  async function seed(): Promise<string> {
    const row = await database
      .context(null)
      .sudo()
      .db.Doc.create({ data: { title: 'a' } })
    return String(row?.id)
  }

  test('a delete reports the replaced row, while beforeTransaction keeps the gate snapshot', async () => {
    const id = await seed()
    const admin = database.context(null).sudo()
    replace = () => admin.db.Doc.update({ where: { id }, data: { title: 'b' } })
    seen.length = 0
    const base = database.context({ userId: 'u' })
    const result = await base.db.Doc.delete({ where: { id } })
    expect(result).not.toBeNull()
    const delSeen = seen
    expect(delSeen).toContainEqual({ hook: 'beforeTransaction', title: 'a' })
    expect(delSeen).toContainEqual({ hook: 'beforeOperation', title: 'b' })
    expect(delSeen.filter((s) => s.hook === 'afterTransaction:committed').at(-1)).toEqual({
      hook: 'afterTransaction:committed',
      title: 'b',
    })
  })

  test('a rolled-back delete reports the replaced row', async () => {
    const id = await seed()
    const admin = database.context(null).sudo()
    replace = () => admin.db.Doc.update({ where: { id }, data: { title: 'b' } })
    failAfterLock = true
    await expect(
      database.context({ userId: 'u' }).db.Doc.delete({ where: { id } }),
    ).rejects.toThrow('boom')
    expect(seen.filter((s) => s.hook === 'afterTransaction:rolled-back').at(-1)).toEqual({
      hook: 'afterTransaction:rolled-back',
      title: 'b',
    })
  })

  test('a deferred joined delete reports the replaced row', async () => {
    const id = await seed()
    await database.context({ userId: 'u' }).transaction(async (tx) => {
      replace = () => tx.sudo().db.Doc.update({ where: { id }, data: { title: 'b' } })
      await tx.db.Doc.delete({ where: { id } })
    })
    expect(seen.filter((s) => s.hook === 'afterTransaction:committed').at(-1)).toEqual({
      hook: 'afterTransaction:committed',
      title: 'b',
    })
  })
})
