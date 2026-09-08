import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from '../access/types.js'
import { integer, relationship, text } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import { RowLockUnavailableError } from '../secured/lock.js'

const BOOT = 120_000

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Slot: {
      fields: {
        name: text(),
        capacity: integer(),
        bookings: relationship({ ref: 'Booking.slot', many: true }),
        tags: relationship({ ref: 'SlotTag.slot', many: true }),
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
    Booking: {
      fields: { holder: text(), slot: relationship({ ref: 'Slot.bookings' }) },
      access: { operation: { query: () => true, create: () => true } },
    },
    Tag: {
      fields: { label: text(), slots: relationship({ ref: 'SlotTag.tag', many: true }) },
      access: { operation: { query: () => true, create: () => true } },
    },
    SlotTag: {
      fields: {
        slot: relationship({ ref: 'Slot.tags' }),
        tag: relationship({ ref: 'Tag.slots' }),
      },
      access: { operation: { query: () => true, create: () => true, delete: () => true } },
    },
  },
}

const anonymous: Session | null = null

/**
 * Two independent extensions of the context — the row lock's lane (ADR-0047,
 * ADR-0062) and junction edge creation (ADR-0050) — landed on the same build
 * from different branches. `getContext` rebuilds itself on `sudo()`,
 * `withSession()` and the transaction rebind, and the rebind names the members
 * it carries by hand (#1345), so a silent drop is a real failure mode that a
 * clean textual merge does not rule out.
 */
describe('the row lock and junction edge creation share a context', () => {
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

  async function locksInsideTransaction(
    context: ReturnType<TestDatabase['context']>,
  ): Promise<string[]> {
    return context.transaction(async (tx) => {
      const rows = await tx.db.Slot.where({ name: { equals: 'a' } })
        .forUpdate()
        .all()
      return rows.map((row) => String(row.name))
    })
  }

  async function addsAnEdge(context: ReturnType<TestDatabase['context']>): Promise<unknown> {
    const slot = await context.sudo().db.Slot.create({ data: { name: 'a', capacity: 1 } })
    const tag = await context.sudo().db.Tag.create({ data: { label: 't' } })
    return context.serverAction({
      listKey: 'Slot',
      action: 'addRelated',
      field: 'tags',
      parentId: String(slot?.id),
      targetId: String(tag?.id),
    })
  }

  test('both lanes answer on the plain context', async () => {
    const context = database.context(anonymous)
    await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
    expect(await locksInsideTransaction(context)).toEqual(['a'])
    expect(await addsAnEdge(database.context(anonymous))).toMatchObject({ added: true })
  })

  test('both lanes answer on sudo()', async () => {
    const context = database.context(anonymous).sudo()
    await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
    expect(await locksInsideTransaction(context)).toEqual(['a'])
    expect(await addsAnEdge(database.context(anonymous).sudo())).toMatchObject({ added: true })
  })

  test('both lanes answer on withSession()', async () => {
    const context = database.context(anonymous).withSession({ userId: 'u1' })
    await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
    expect(await locksInsideTransaction(context)).toEqual(['a'])
    expect(
      await addsAnEdge(database.context(anonymous).withSession({ userId: 'u1' })),
    ).toMatchObject({ added: true })
  })

  test('both lanes answer on the transaction rebind, and on its derived contexts', async () => {
    const context = database.context(anonymous)
    const slot = await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })
    const tag = await context.db.Tag.create({ data: { label: 't' } })

    await context.transaction(async (tx) => {
      await tx.advisoryLock('probe')
      await tx.sudo().advisoryLock('probe-sudo')
      await tx.withSession({ userId: 'u1' }).advisoryLock('probe-session')
      await tx.transaction(async (nested) => nested.advisoryLock('probe-nested'))

      expect(
        (
          await tx.db.Slot.where({ name: { equals: 'a' } })
            .forUpdate()
            .all()
        ).length,
      ).toBe(1)
      expect(
        (
          await tx
            .sudo()
            .db.Slot.where({ name: { equals: 'a' } })
            .forUpdate()
            .all()
        ).length,
      ).toBe(1)
      expect(
        (
          await tx
            .withSession({ userId: 'u1' })
            .db.Slot.where({ name: { equals: 'a' } })
            .forUpdate()
            .all()
        ).length,
      ).toBe(1)

      const added = await tx.serverAction({
        listKey: 'Slot',
        action: 'addRelated',
        field: 'tags',
        parentId: String(slot?.id),
        targetId: String(tag?.id),
      })
      expect(added).toMatchObject({ added: true })

      const addedBySudo = await tx.sudo().serverAction({
        listKey: 'Slot',
        action: 'addRelated',
        field: 'tags',
        parentId: String(slot?.id),
        targetId: String(tag?.id),
      })
      expect(addedBySudo).toMatchObject({ added: true })
    })
  })

  test('the lock is still refused off a transaction, on every derived context', async () => {
    const context = database.context(anonymous)
    await context.db.Slot.create({ data: { name: 'a', capacity: 1 } })

    for (const derived of [
      context,
      context.sudo(),
      context.withSession({ userId: 'u1' }),
      context.sudo().withSession({ userId: 'u1' }),
    ]) {
      await expect(
        derived.db.Slot.where({ name: { equals: 'a' } })
          .forUpdate()
          .all(),
      ).rejects.toBeInstanceOf(RowLockUnavailableError)
    }
  })
})
