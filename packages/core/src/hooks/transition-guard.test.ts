import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { list } from '../config/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { select, text } from '../fields/index.js'
import { createTestContext, type TestContext } from '../testing/context.js'
import { transitionGuard } from './transition-guard.js'

const BOOT = 120_000

const states = ['PREPARED', 'DISPATCHING', 'DONE'].map((value) => ({ label: value, value }))
const actions = ['EDIT', 'VOID'].map((value) => ({ label: value, value }))

const keyed = transitionGuard({
  field: 'state',
  discriminator: 'action',
  initial: { EDIT: ['PREPARED'], VOID: ['DONE'] },
  allowed: { EDIT: { PREPARED: ['DISPATCHING'] }, VOID: { DONE: ['DONE'] } },
})

const flat = transitionGuard({
  field: 'state',
  initial: ['PREPARED'],
  allowed: { PREPARED: ['DISPATCHING'], DISPATCHING: ['DONE'] },
})

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Operation: list({
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
      fields: {
        action: select({ options: actions, validation: { isRequired: true } }),
        state: select({ options: states, validation: { isRequired: true } }),
        note: text(),
      },
      hooks: {
        validate: keyed,
        resolveInput: async ({ resolvedData, operation }) =>
          operation === 'update' && resolvedData.note === 'advance'
            ? { ...resolvedData, state: 'DISPATCHING' }
            : operation === 'update' && resolvedData.note === 'skip'
              ? { ...resolvedData, state: 'DONE' }
              : resolvedData,
      },
    }),
    Ticket: list({
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
      fields: { state: select({ options: states, validation: { isRequired: true } }) },
      hooks: { validate: flat },
    }),
  },
}

describe('transitionGuard', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(config, { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  async function operation(action: string, state: string): Promise<string> {
    const row = await harness.context.sudo().db.Operation.create({ data: { action, state } })
    if (row === null) throw new Error('seed refused')
    return String(row.id)
  }

  async function dispatching(action: string): Promise<string> {
    const id = await operation(action, 'PREPARED')
    await harness.context
      .sudo()
      .db.Operation.update({ where: { id }, data: { state: 'DISPATCHING' } })
    return id
  }

  async function ticket(state: string): Promise<string> {
    const row = await harness.context.sudo().db.Ticket.create({ data: { state } })
    if (row === null) throw new Error('seed refused')
    return String(row.id)
  }

  test('creates in an allowed initial state and refuses any other', async () => {
    const db = harness.context.db
    await expect(
      db.Operation.create({ data: { action: 'EDIT', state: 'PREPARED' } }),
    ).resolves.toMatchObject({ state: 'PREPARED' })
    await expect(db.Operation.create({ data: { action: 'EDIT', state: 'DONE' } })).rejects.toThrow(
      /"state" for action "EDIT" cannot start as "DONE"/,
    )
  })

  test('updates along an allowed edge and refuses an undeclared one', async () => {
    const id = await operation('EDIT', 'PREPARED')
    const db = harness.context.db
    await expect(db.Operation.update({ where: { id }, data: { state: 'DONE' } })).rejects.toThrow(
      /cannot change from "PREPARED" to "DONE"/,
    )
    await expect(
      db.Operation.update({ where: { id }, data: { state: 'DISPATCHING' } }),
    ).resolves.toMatchObject({ state: 'DISPATCHING' })
  })

  test('an update that repeats the state, or omits it, passes', async () => {
    const id = await operation('EDIT', 'PREPARED')
    const db = harness.context.db
    await expect(
      db.Operation.update({ where: { id }, data: { state: 'PREPARED' } }),
    ).resolves.toMatchObject({ state: 'PREPARED' })
    await expect(
      db.Operation.update({ where: { id }, data: { note: 'hi' } }),
    ).resolves.toMatchObject({ note: 'hi' })
  })

  test('is enforced under sudo()', async () => {
    const id = await operation('EDIT', 'PREPARED')
    await expect(
      harness.context.sudo().db.Operation.update({ where: { id }, data: { state: 'DONE' } }),
    ).rejects.toThrow(/cannot change/)
  })

  test('checks a transition made by resolveInput', async () => {
    const db = harness.context.db
    const allowed = await operation('EDIT', 'PREPARED')
    await expect(
      db.Operation.update({ where: { id: allowed }, data: { note: 'advance' } }),
    ).resolves.toMatchObject({ state: 'DISPATCHING' })
    const refused = await operation('EDIT', 'PREPARED')
    await expect(
      db.Operation.update({ where: { id: refused }, data: { note: 'skip' } }),
    ).rejects.toThrow(/cannot change from "PREPARED" to "DONE"/)
  })

  test('reads the discriminator from the item when the payload omits it', async () => {
    const id = await operation('VOID', 'DONE')
    await expect(
      harness.context.db.Operation.update({ where: { id }, data: { state: 'DISPATCHING' } }),
    ).rejects.toThrow(/for action "VOID"/)
  })

  test('an allowed update takes its discriminator from the item', async () => {
    const id = await operation('EDIT', 'PREPARED')
    await expect(
      harness.context.db.Operation.update({ where: { id }, data: { state: 'DISPATCHING' } }),
    ).resolves.toMatchObject({ state: 'DISPATCHING' })
  })

  test('re-checks the state when only the discriminator changes', async () => {
    const db = harness.context.db
    const legal = await operation('EDIT', 'PREPARED')
    await expect(
      db.Operation.update({ where: { id: legal }, data: { action: 'VOID' } }),
    ).rejects.toThrow(/cannot stay "PREPARED" under action "VOID"/)
    const done = await operation('VOID', 'DONE')
    await expect(
      db.Operation.update({ where: { id: done }, data: { action: 'EDIT' } }),
    ).rejects.toThrow(/cannot stay "DONE" under action "EDIT"/)
    const moving = await dispatching('EDIT')
    await expect(
      db.Operation.update({ where: { id: moving }, data: { action: 'EDIT' } }),
    ).resolves.toMatchObject({ action: 'EDIT' })
  })

  test('works without a discriminator', async () => {
    const db = harness.context.db
    await expect(db.Ticket.create({ data: { state: 'DONE' } })).rejects.toThrow(
      /"state" cannot start as "DONE"/,
    )
    const id = await ticket('PREPARED')
    await expect(db.Ticket.update({ where: { id }, data: { state: 'DONE' } })).rejects.toThrow(
      /cannot change from "PREPARED" to "DONE"/,
    )
    await expect(
      db.Ticket.update({ where: { id }, data: { state: 'DISPATCHING' } }),
    ).resolves.toMatchObject({ state: 'DISPATCHING' })
    await expect(
      db.Ticket.update({ where: { id }, data: { state: 'DONE' } }),
    ).resolves.toMatchObject({ state: 'DONE' })
  })
})
