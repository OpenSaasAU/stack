import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import {
  composeItemViewRead,
  readAccessScopedTotal,
  sectionRows,
} from '../../src/components/ItemForm.js'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'

const OPEN = { query: () => true, create: () => true, update: () => true }

/**
 * The item view pages every Relationship table, so a rule reading its own
 * relation is never handed the rows. `ItemViewLayoutView` turns a read that
 * throws into "Item not found", so a rule that dereferences the relation has to
 * come back as a denial of that section and nothing more (#2210).
 */
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Ticket: {
        fields: {
          name: text(),
          summary: text({
            access: { read: ({ item }) => (item.logs as readonly unknown[]).length === 0 },
          }),
          logs: relationship({
            ref: 'Log.ticket',
            many: true,
            access: { read: ({ item }) => (item.logs as readonly unknown[]).length === 0 },
          }),
          notes: relationship({ ref: 'Note.ticket', many: true }),
        },
        access: { operation: OPEN },
      },
      Log: {
        fields: { body: text(), ticket: relationship({ ref: 'Ticket.logs' }) },
        access: { operation: OPEN },
      },
      Note: {
        fields: { body: text(), ticket: relationship({ ref: 'Ticket.notes' }) },
        access: { operation: OPEN },
      },
    },
  }
}

describe('the item view of a row whose rule reads a paged relation', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(makeConfig(), null)
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  it('finds the item, shows the other section, and leaves the denied one empty', async () => {
    const config = makeConfig()
    const layout = deriveItemViewLayout(config, 'Ticket')
    expect(layout.sections.map((section) => section.fieldName).sort()).toEqual(['logs', 'notes'])

    const context = harness.context as unknown as AccessContext
    const ticket = await context.db.Ticket.create({ data: { name: 'one', summary: 'private' } })
    const connect = { ticket: { connect: { id: ticket?.id } } }
    await context.db.Log.create({ data: { body: 'a log', ...connect } })
    await context.db.Note.create({ data: { body: 'a note', ...connect } })

    const itemData = await composeItemViewRead(
      context.db.Ticket.where({ id: ticket?.id as string }),
      config.lists.Ticket,
      layout,
    ).first()

    expect(itemData).toMatchObject({ name: 'one' })
    expect(itemData).not.toHaveProperty('summary')
    expect(itemData).not.toHaveProperty('logs')
    expect(sectionRows(itemData?.logs)).toEqual([])
    expect(readAccessScopedTotal(itemData?.logs, 0)).toBe(0)
    expect(sectionRows(itemData?.notes)).toHaveLength(1)
    expect(readAccessScopedTotal(itemData?.notes, 0)).toBe(1)
  })
})
