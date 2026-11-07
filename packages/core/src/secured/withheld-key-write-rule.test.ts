import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'

const BOOT = 120_000

type Locks = readonly { active: boolean }[] | undefined

const unlocked = ({ item }: { item?: Record<string, unknown> }): boolean =>
  !(item?.locks as Locks)?.some((lock) => lock.active)

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Ticket: {
      fields: {
        name: text(),
        locks: relationship({ ref: 'Lock.ticket', many: true }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: unlocked,
          delete: unlocked,
        },
      },
    },
    Gated: {
      fields: {
        name: text(),
        status: text({ access: { update: unlocked } }),
        locks: relationship({ ref: 'Lock.gated', many: true }),
      },
      access: { operation: { query: () => true, create: () => true, update: () => true } },
    },
    Plain: {
      fields: { name: text(), owner: text(), status: text({ access: { update: () => true } }) },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: ({ item, session }) => item?.owner === session?.userId,
          delete: ({ item, session }) => item?.owner === session?.userId,
        },
      },
    },
    Lock: {
      fields: {
        active: text(),
        ticket: relationship({ ref: 'Ticket.locks' }),
        gated: relationship({ ref: 'Gated.locks' }),
      },
      access: { operation: { query: () => true, create: () => true } },
    },
  },
}

describe('a write rule that reaches for an undelivered relation denies', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await db.close()
  })

  test('operation update and delete deny on a locked ticket', async () => {
    const admin = db.context({ userId: 'u' }).sudo()
    const ticket = await admin.db.Ticket.create({ data: { name: 't' } })
    await admin.db.Lock.create({ data: { active: 'x', ticket: { connect: { id: ticket!.id } } } })
    const ctx = db.context({ userId: 'u' })
    expect(
      await ctx.db.Ticket.update({ where: { id: ticket!.id }, data: { name: 'n' } }),
    ).toBeNull()
    expect(await ctx.db.Ticket.delete({ where: { id: ticket!.id } })).toBeNull()
  })

  test('a field update rule denies', async () => {
    const admin = db.context({ userId: 'u' }).sudo()
    const gated = await admin.db.Gated.create({ data: { name: 'f' } })
    const ctx = db.context({ userId: 'u' })
    await expect(
      ctx.db.Gated.update({ where: { id: gated!.id }, data: { status: 'x' } }),
    ).rejects.toThrow('field-level access denied')
  })

  test('rules reading only scalars behave as before', async () => {
    const mine = db.context({ userId: 'me' })
    const row = await mine.db.Plain.create({ data: { name: 'p', owner: 'me' } })
    const theirs = db.context({ userId: 'other' })
    expect(await theirs.db.Plain.update({ where: { id: row!.id }, data: { name: 'x' } })).toBeNull()
    const updated = await mine.db.Plain.update({
      where: { id: row!.id },
      data: { name: 'y', status: 's' },
    })
    expect(updated?.name).toBe('y')
    expect(await mine.db.Plain.delete({ where: { id: row!.id } })).not.toBeNull()
  })
})
