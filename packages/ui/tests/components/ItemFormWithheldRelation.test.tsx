import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import {
  ItemForm,
  composeItemViewRead,
  readAccessScopedTotal,
  sectionRows,
} from '../../src/components/ItemForm.js'
import { RelationshipCell } from '../../src/components/cells/RelationshipCell.js'
import { RelationshipTableClient } from '../../src/components/RelationshipTableClient.js'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

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

    const { context } = harness
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

/** The Relationship tables an element tree holds, by field name, with what each was told. */
function tablesIn(node: React.ReactNode, found = new Map<string, unknown>()) {
  if (Array.isArray(node)) for (const child of node) tablesIn(child, found)
  if (!React.isValidElement<Record<string, unknown>>(node)) return found
  const { section, unavailable, children } = node.props
  if (typeof section === 'object' && section !== null && 'fieldName' in section) {
    found.set(String(section.fieldName), unavailable)
  }
  if (children !== undefined) tablesIn(children as React.ReactNode, found)
  return found
}

describe('the item view tells a table what the read withheld', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(makeConfig(), null)
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  it('marks the withheld section and only that one', async () => {
    const { context } = harness
    const ticket = await context.db.Ticket.create({ data: { name: 'one' } })

    const view = await ItemForm({
      context,
      config: makeConfig(),
      listKey: 'Ticket',
      mode: 'edit',
      itemId: ticket?.id as string,
      serverAction: async () => null,
    })
    if (!React.isValidElement<Record<string, unknown>>(view) || typeof view.type !== 'function') {
      throw new Error('expected the item view layout')
    }
    const render = view.type as (props: Record<string, unknown>) => Promise<React.ReactNode>

    const tables = tablesIn(await render(view.props))

    expect(tables.get('logs')).toBe(true)
    expect(tables.get('notes')).toBe(false)
  })
})

describe('a relation the read withheld is not an empty one', () => {
  const tableProps = {
    title: 'Logs',
    relatedUrlKey: 'log',
    basePath: '/admin',
    columns: ['body'],
    fields: { body: { type: 'text' } },
    rows: [],
    count: 0,
    total: 0,
    sumColumns: [],
    sums: {},
    removeMode: null,
    relatedListKey: 'Log',
    parentId: 't1',
    parentListKey: 'Ticket',
    serverAction: async () => null,
  }

  it('renders no number in the list view cell, and a real zero as a zero', () => {
    const field = { type: 'relationship', many: true }
    const { container, rerender } = render(
      <RelationshipCell value={null} field={field} fieldName="logs" />,
    )
    expect(container.querySelector('[data-slot="cell-relationship-count"]')).toBeNull()
    expect(container.textContent).not.toContain('0')

    rerender(<RelationshipCell value={0} field={field} fieldName="logs" />)
    expect(container.querySelector('[data-slot="cell-relationship-count"]')?.textContent).toBe('0')
  })

  it('says the table cannot be shown, and claims no count', () => {
    render(<RelationshipTableClient {...tableProps} unavailable />)

    expect(screen.getByText("Logs can't be shown here.")).toBeTruthy()
    expect(screen.queryByText(/No related/)).toBeNull()
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  it('keeps the empty state for a relation that really is empty', () => {
    render(<RelationshipTableClient {...tableProps} />)

    expect(screen.getByText('No related logs yet.')).toBeTruthy()
    expect(screen.getByText('Showing 0 of 0 rows')).toBeTruthy()
  })
})
