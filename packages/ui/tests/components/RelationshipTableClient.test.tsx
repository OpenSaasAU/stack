import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipTableClient } from '../../src/components/RelationshipTableClient.js'
import type { RelationshipTableClientProps } from '../../src/components/RelationshipTableClient.js'

// Mock Next.js navigation (client component uses useRouter for row navigation
// and refresh after a removal).
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

const noopAction = vi.fn(async () => ({ removed: true }))

function baseProps(): RelationshipTableClientProps {
  return {
    title: 'Posts',
    relatedUrlKey: 'post',
    basePath: '/admin',
    columns: ['title', 'viewCount'],
    fields: { title: { type: 'text' }, viewCount: { type: 'integer' } },
    rows: [
      { id: 'p1', title: 'First', viewCount: 5 },
      { id: 'p2', title: 'Second', viewCount: 10 },
    ],
    count: 2,
    sumColumns: ['viewCount'],
    sums: { viewCount: 15 },
    removeMode: null,
    relatedListKey: 'Post',
    backReferenceField: 'author',
    parentId: 'u1',
    parentListKey: 'User',
    serverAction: noopAction,
  }
}

describe('RelationshipTableClient', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockRefresh.mockClear()
    noopAction.mockClear()
  })

  it('renders the section heading, columns, and rows', () => {
    render(<RelationshipTableClient {...baseProps()} />)

    expect(screen.getByRole('heading', { name: 'Posts' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'View Count' })).toBeInTheDocument()
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('always shows the row count and sums configured numeric columns via the Cell', () => {
    render(<RelationshipTableClient {...baseProps()} />)

    const footer = document.querySelector('[data-slot="relationship-table-footer"]')
    expect(footer).not.toBeNull()
    // Count always shown; summed column rendered through its Cell (5 + 10 = 15).
    expect(footer).toHaveTextContent('2 rows')
    expect(footer).toHaveTextContent('15')
  })

  it('navigates to the related record when a row is clicked', async () => {
    render(<RelationshipTableClient {...baseProps()} />)
    const user = userEvent.setup()

    await user.click(screen.getByText('First'))
    expect(mockPush).toHaveBeenCalledWith('/admin/post/p1')
  })

  it('renders an empty state and a zero-count footer with no rows', () => {
    render(<RelationshipTableClient {...baseProps()} rows={[]} count={0} />)

    expect(screen.getByText(/no related posts/i)).toBeInTheDocument()
    const footer = document.querySelector('[data-slot="relationship-table-footer"]')
    expect(footer).toHaveTextContent('0 rows')
  })

  it('still shows the row count when there are zero columns (only the back-reference curated away)', () => {
    render(
      <RelationshipTableClient
        {...baseProps()}
        columns={[]}
        fields={{}}
        sumColumns={[]}
        sums={{}}
        count={3}
      />,
    )

    const footer = document.querySelector('[data-slot="relationship-table-footer"]')
    expect(footer).not.toBeNull()
    // The always-shown count must survive the zero-column footer.
    expect(within(footer as HTMLElement).getByText('3 rows')).toBeInTheDocument()
  })

  // ---- Row removal (issue #739) ----

  it('renders no removal control when removeMode is null', () => {
    render(<RelationshipTableClient {...baseProps()} removeMode={null} />)
    expect(document.querySelector('[data-slot="relationship-table-remove"]')).toBeNull()
  })

  it('disconnects a row through the secured context and refreshes on success', async () => {
    const serverAction = vi.fn(async () => ({ removed: true }))
    render(
      <RelationshipTableClient
        {...baseProps()}
        removeMode="disconnect"
        serverAction={serverAction}
      />,
    )
    const user = userEvent.setup()

    const removeButtons = screen.getAllByRole('button', { name: /disconnect posts row/i })
    await user.click(removeButtons[0])

    // Disconnect is an UPDATE on the RELATED list, nulling the back-reference —
    // never a delete, and never the parent's list.
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'removeRelated',
      mode: 'disconnect',
      id: 'p1',
      field: 'author',
      parentId: 'u1',
    })
    // Optimistically hidden, then the table refreshes so the re-fetch is source of truth.
    expect(screen.queryByText('First')).not.toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
    // The removal click must not also navigate the row.
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('leaves the row in place with a visible reason on a Silent failure', async () => {
    const serverAction = vi.fn(async () => ({
      removed: false,
      error: 'Access denied or operation failed',
    }))
    render(
      <RelationshipTableClient
        {...baseProps()}
        removeMode="disconnect"
        serverAction={serverAction}
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getAllByRole('button', { name: /disconnect posts row/i })[0])

    // Denied: the row stays and the reason is shown (no leak of denied-vs-missing).
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/access denied/i)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  // ---- Pre-linked create drawer (issue #738) ----

  it('renders no "+ Add" control when create is not allowed (default)', () => {
    render(<RelationshipTableClient {...baseProps()} />)
    expect(document.querySelector('[data-slot="relationship-table-add"]')).toBeNull()
  })

  it('mounts the pre-linked create "+ Add" on the toolbar seam when create is allowed', () => {
    render(
      <RelationshipTableClient
        {...baseProps()}
        canCreate
        createFields={{ title: { type: 'text', validation: { isRequired: true } } }}
        relatedListTitle="Post"
      />,
    )
    const toolbar = document.querySelector('[data-slot="relationship-table-toolbar"]')
    expect(toolbar).not.toBeNull()
    expect(
      within(toolbar as HTMLElement).getByRole('button', { name: /add post/i }),
    ).toBeInTheDocument()
  })

  it('does not render "+ Add" when create is allowed but no fields were prepared', () => {
    render(<RelationshipTableClient {...baseProps()} canCreate relatedListTitle="Post" />)
    expect(document.querySelector('[data-slot="relationship-table-add"]')).toBeNull()
  })

  it('confirms before deleting when removeAction is delete', async () => {
    const serverAction = vi.fn(async () => ({ removed: true }))
    render(
      <RelationshipTableClient {...baseProps()} removeMode="delete" serverAction={serverAction} />,
    )
    const user = userEvent.setup()

    await user.click(screen.getAllByRole('button', { name: /delete posts row/i })[0])

    // A confirmation dialog appears; no action runs until confirmed.
    expect(serverAction).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // Confirmed → a delete on the related list (the secured context path).
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'removeRelated',
      mode: 'delete',
      id: 'p1',
    })
    expect(mockRefresh).toHaveBeenCalled()
  })
})
