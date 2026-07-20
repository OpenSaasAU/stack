import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipCreateDrawer } from '../../src/components/RelationshipCreateDrawer.js'
import type { RelationshipCreateDrawerProps } from '../../src/components/RelationshipCreateDrawer.js'

// The drawer refreshes the table on a successful create (never navigates away).
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

function baseProps(): RelationshipCreateDrawerProps {
  return {
    relatedListKey: 'Post',
    title: 'Post',
    // The related list's create fields with the back-reference (`author`)
    // removed — `slug` is required but is deliberately not a table column, the
    // acceptance case a drawer (not an inline draft row) exists to serve.
    fields: {
      title: { type: 'text', validation: { isRequired: true } },
      slug: { type: 'text', validation: { isRequired: true } },
    },
    relationshipData: {},
    backReferenceField: 'author',
    parentId: 'u1',
    basePath: '/admin',
    serverAction: vi.fn(async () => ({ created: true, id: 'p1' })),
  }
}

describe('RelationshipCreateDrawer', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockRefresh.mockClear()
  })

  it('shows an "+ Add" control and no drawer until opened', () => {
    render(<RelationshipCreateDrawer {...baseProps()} />)
    expect(screen.getByRole('button', { name: /add post/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a drawer hosting the create form, including required non-column fields', async () => {
    render(<RelationshipCreateDrawer {...baseProps()} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /add post/i }))

    const dialog = screen.getByRole('dialog')
    // The full create form is present — including `slug`, a required field that
    // is NOT one of the table's columns.
    expect(within(dialog).getByLabelText(/title/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/slug/i)).toBeInTheDocument()
  })

  it('creates the row pre-linked to the parent, then closes and refreshes', async () => {
    const serverAction = vi.fn(async () => ({ created: true, id: 'p1' }))
    render(<RelationshipCreateDrawer {...baseProps()} serverAction={serverAction} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /add post/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/title/i), 'Hello')
    await user.type(within(dialog).getByLabelText(/slug/i), 'hello')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    // The create runs on the RELATED list; the back-reference (`author`) +
    // parentId are passed so the SERVER links the row to exactly this parent —
    // the client never sets the link in `data`.
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'createRelated',
      data: { title: 'Hello', slug: 'hello' },
      field: 'author',
      parentId: 'u1',
    })
    // Success is in-place: the table refreshes and the drawer closes (no navigation).
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the drawer open and shows the reason on a create denial (Silent failure)', async () => {
    const serverAction = vi.fn(async () => ({
      created: false,
      error: 'Access denied or create failed',
    }))
    render(<RelationshipCreateDrawer {...baseProps()} serverAction={serverAction} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /add post/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/title/i), 'Hello')
    await user.type(within(dialog).getByLabelText(/slug/i), 'hello')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    // Denied: the drawer stays open with the generic reason; no refresh.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/access denied/i)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('surfaces per-field errors returned by the create in the drawer', async () => {
    const serverAction = vi.fn(async () => ({
      created: false,
      error: 'Title must be unique. The value you entered is already in use.',
      fieldErrors: { title: 'This title is already in use' },
    }))
    render(<RelationshipCreateDrawer {...baseProps()} serverAction={serverAction} />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /add post/i }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/title/i), 'Dup')
    await user.type(within(dialog).getByLabelText(/slug/i), 'dup')
    await user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(screen.getByText('This title is already in use')).toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
