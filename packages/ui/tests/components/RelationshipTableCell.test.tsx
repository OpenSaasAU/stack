import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipTableCell } from '../../src/components/RelationshipTableCell.js'
import type { RelationshipTableCellProps } from '../../src/components/RelationshipTableCell.js'

// The cell refreshes the table on a successful commit.
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}))

function props(overrides: Partial<RelationshipTableCellProps> = {}): RelationshipTableCellProps {
  return {
    rowId: 'p1',
    column: 'title',
    value: 'Old Title',
    field: { type: 'text' },
    basePath: '/admin',
    numeric: false,
    editable: true,
    relatedListKey: 'Post',
    serverAction: vi.fn(async () => ({ updated: true })),
    ...overrides,
  }
}

describe('RelationshipTableCell (inline cell edit, #737)', () => {
  beforeEach(() => {
    mockRefresh.mockClear()
  })

  it('renders a read-only Cell with no edit affordance when not editable', () => {
    render(<RelationshipTableCell {...props({ editable: false })} />)
    expect(screen.getByText('Old Title')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="relationship-table-cell-edit-trigger"]')).toBeNull()
  })

  it('renders a read-only Cell when editable but no field component is registered', () => {
    // An unknown field type resolves no form component → read-only fallback,
    // never an "unsupported field type" placeholder inside the table.
    render(<RelationshipTableCell {...props({ field: { type: 'mystery' }, value: 'x' })} />)
    expect(screen.getByText('x')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="relationship-table-cell-edit-trigger"]')).toBeNull()
  })

  it('commits a single-field update through the secured context on Enter and refreshes', async () => {
    const serverAction = vi.fn(async () => ({ updated: true }))
    render(<RelationshipTableCell {...props({ serverAction })} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Old Title' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'New Title{Enter}')

    // Exactly one field updated on the RELATED row via the secured context.
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'updateRelated',
      id: 'p1',
      field: 'title',
      value: 'New Title',
    })
    // Optimistic: the new value shows and the table refreshes.
    expect(screen.getByText('New Title')).toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('reverts with a visible reason on a Silent failure (access denied / row gone)', async () => {
    const serverAction = vi.fn(async () => ({
      updated: false,
      error: 'Access denied or operation failed',
    }))
    render(<RelationshipTableCell {...props({ serverAction })} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Old Title' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Nope{Enter}')

    // Reverted to the original value with the reason shown; no refresh.
    expect(screen.getByRole('button', { name: 'Old Title' })).toBeInTheDocument()
    expect(screen.queryByText('Nope')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/access denied/i)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('surfaces an inline field validation error and reverts', async () => {
    const serverAction = vi.fn(async () => ({
      updated: false,
      error: 'Validation failed',
      fieldErrors: { title: 'Title cannot contain the word "spam"' },
    }))
    render(<RelationshipTableCell {...props({ serverAction })} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Old Title' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'spam{Enter}')

    // Field-specific message wins over the generic error.
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot contain the word "spam"/i)
    expect(screen.getByRole('button', { name: 'Old Title' })).toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('cancels on Escape without calling the server action', async () => {
    const serverAction = vi.fn(async () => ({ updated: true }))
    render(<RelationshipTableCell {...props({ serverAction })} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Old Title' }))
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Discarded{Escape}')

    expect(serverAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Old Title' })).toBeInTheDocument()
    expect(screen.queryByText('Discarded')).not.toBeInTheDocument()
  })

  it('does not call the server action when committing an unchanged value', async () => {
    const serverAction = vi.fn(async () => ({ updated: true }))
    render(<RelationshipTableCell {...props({ serverAction })} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Old Title' }))
    const input = screen.getByRole('textbox')
    await user.type(input, '{Enter}') // no edit

    expect(serverAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Old Title' })).toBeInTheDocument()
  })

  it('renders a select value as a Badge and stays a Badge after committing (registry re-render)', async () => {
    const field = {
      type: 'select',
      options: [
        { label: 'Draft', value: 'draft', ui: { variant: 'secondary' as const } },
        { label: 'Published', value: 'published', ui: { variant: 'success' as const } },
      ],
    }
    render(<RelationshipTableCell {...props({ column: 'status', value: 'draft', field })} />)
    // Read display renders through the cell registry: a Badge, not raw text.
    const trigger = screen.getByRole('button', { name: 'Draft' })
    expect(trigger.querySelector('[data-slot="cell-select"]')).not.toBeNull()
  })
})
