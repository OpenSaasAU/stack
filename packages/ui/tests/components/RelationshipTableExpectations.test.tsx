import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipTableClient } from '../../src/components/RelationshipTableClient.js'
import type { RelationshipTableClientProps } from '../../src/components/RelationshipTableClient.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
const mockReplace = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh, replace: mockReplace }),
  usePathname: () => '/admin/author/u1',
  useSearchParams: () => new URLSearchParams(),
}))

type Action = RelationshipTableClientProps['serverAction']

function props(
  overrides: Partial<RelationshipTableClientProps> = {},
): RelationshipTableClientProps {
  return {
    title: 'Posts',
    relatedUrlKey: 'post',
    basePath: '/admin',
    columns: ['title', 'views'],
    fields: { title: { type: 'text' }, views: { type: 'integer' } },
    rows: [
      { id: 'p1', title: 'Hello world', views: 5 },
      { id: 'p2', title: 'Second post', views: 10 },
    ],
    count: 2,
    sumColumns: [],
    sums: {},
    removeMode: null,
    relatedListKey: 'Post',
    relatedListTitle: 'Post',
    backReferenceField: 'author',
    parentId: 'u1',
    parentListKey: 'Author',
    labelColumn: 'title',
    serverAction: vi.fn<Action>(async () => ({ removed: true })),
    ...overrides,
  }
}

beforeEach(() => {
  mockPush.mockClear()
  mockRefresh.mockClear()
  mockReplace.mockClear()
})

describe('a related row can be opened without a mouse', () => {
  it('links each row title to the related record', () => {
    render(<RelationshipTableClient {...props()} />)

    expect(screen.getByRole('link', { name: 'Hello world' })).toHaveAttribute(
      'href',
      '/admin/post/p1',
    )
    expect(screen.getByRole('link', { name: 'Second post' })).toHaveAttribute(
      'href',
      '/admin/post/p2',
    )
  })

  it('opens the record once when the title link is clicked', async () => {
    render(<RelationshipTableClient {...props()} />)

    await userEvent.click(screen.getByRole('link', { name: 'Hello world' }))

    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/admin/post/p1')
  })

  it('offers an Open link beside an editable title instead of wrapping it', () => {
    render(<RelationshipTableClient {...props({ editableColumns: ['title'] })} />)

    expect(screen.getByRole('link', { name: 'Open Hello world' })).toHaveAttribute(
      'href',
      '/admin/post/p1',
    )
  })

  it('links the first column when the label column is not shown', () => {
    render(<RelationshipTableClient {...props({ labelColumn: undefined })} />)

    expect(screen.getByRole('link', { name: 'Hello world' })).toHaveAttribute(
      'href',
      '/admin/post/p1',
    )
  })
})

describe('each ✕ names the row it removes', () => {
  it('says Unlink and the row when ✕ unlinks', () => {
    render(<RelationshipTableClient {...props({ removeMode: 'disconnect' })} />)

    expect(screen.getByRole('button', { name: 'Unlink “Hello world”' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlink “Second post”' })).toBeInTheDocument()
  })

  it('says Delete and the row when ✕ deletes', () => {
    render(<RelationshipTableClient {...props({ removeMode: 'delete' })} />)

    expect(screen.getByRole('button', { name: 'Delete “Hello world”' })).toBeInTheDocument()
  })

  it('says Unlink for a junction edge, whose ✕ deletes only the link', () => {
    render(
      <RelationshipTableClient {...props({ removeMode: 'delete', junctionTargetTitle: 'Tag' })} />,
    )

    expect(screen.getByRole('button', { name: 'Unlink “Hello world”' })).toBeInTheDocument()
  })

  it('falls back to the row position when the row has no label', () => {
    render(
      <RelationshipTableClient {...props({ removeMode: 'disconnect', labelColumn: undefined })} />,
    )

    expect(screen.getByRole('button', { name: 'Unlink row 1' })).toBeInTheDocument()
  })
})

describe('deleting a related row says what it deletes', () => {
  it('names the row in the confirmation, as the item form does', async () => {
    render(<RelationshipTableClient {...props({ removeMode: 'delete' })} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete “Hello world”' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Delete this Post?')).toBeInTheDocument()
    expect(
      within(dialog).getByText('“Hello world” will be permanently deleted. This cannot be undone.'),
    ).toBeInTheDocument()
  })

  it('says a junction removal keeps the far record', async () => {
    render(
      <RelationshipTableClient {...props({ removeMode: 'delete', junctionTargetTitle: 'Tag' })} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Unlink “Hello world”' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('Unlink “Hello world”?')).toBeInTheDocument()
    expect(
      within(dialog).getByText('This removes the link only. The tag record itself is kept.'),
    ).toBeInTheDocument()
  })
})

describe('an unlink can be undone', () => {
  it('confirms the unlink with an Undo that links the row back', async () => {
    const serverAction = vi.fn<Action>(async (input) =>
      input.action === 'linkRelated' ? { linked: true } : { removed: true },
    )
    render(<RelationshipTableClient {...props({ removeMode: 'disconnect', serverAction })} />)

    await userEvent.click(screen.getByRole('button', { name: 'Unlink “Hello world”' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Unlinked “Hello world”')
    expect(screen.queryByRole('link', { name: 'Hello world' })).not.toBeInTheDocument()

    await userEvent.click(within(status).getByRole('button', { name: 'Undo' }))

    expect(serverAction).toHaveBeenLastCalledWith({
      listKey: 'Post',
      action: 'linkRelated',
      id: 'p1',
      field: 'author',
      parentId: 'u1',
    })
    expect(await screen.findByRole('link', { name: 'Hello world' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('says so when the undo is refused, and keeps the row unlinked', async () => {
    const serverAction = vi.fn<Action>(async (input) =>
      input.action === 'linkRelated'
        ? { linked: false, error: 'Access denied or operation failed' }
        : { removed: true },
    )
    render(<RelationshipTableClient {...props({ removeMode: 'disconnect', serverAction })} />)

    await userEvent.click(screen.getByRole('button', { name: 'Unlink “Hello world”' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Couldn’t link “Hello world” back: Access denied or operation failed',
    )
    expect(screen.queryByRole('link', { name: 'Hello world' })).not.toBeInTheDocument()
  })

  it('offers no Undo after a delete, which is confirmed first', async () => {
    render(<RelationshipTableClient {...props({ removeMode: 'delete' })} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete “Hello world”' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
})

describe('the related rows page in place', () => {
  const paged = {
    rows: [
      { id: 'p11', title: 'Eleventh', views: 1 },
      { id: 'p12', title: 'Twelfth', views: 2 },
    ],
    count: 2,
    total: 42,
    pagination: {
      offset: 10,
      previousHref: '/admin/author/u1',
      nextHref: '/admin/author/u1?postsPage=3',
    },
  }

  it('says which rows are shown and links the pages either side', () => {
    render(<RelationshipTableClient {...props(paged)} />)

    const footer = document.querySelector('[data-slot="relationship-table-footer"]')
    expect(footer).toHaveTextContent('Showing 11–12 of 42 rows')
    expect(screen.getByRole('link', { name: 'Previous page of Posts' })).toHaveAttribute(
      'href',
      '/admin/author/u1',
    )
    expect(screen.getByRole('link', { name: 'Next page of Posts' })).toHaveAttribute(
      'href',
      '/admin/author/u1?postsPage=3',
    )
  })

  it('moves between pages without leaving the item', async () => {
    render(<RelationshipTableClient {...props(paged)} />)

    await userEvent.click(screen.getByRole('link', { name: 'Next page of Posts' }))

    expect(mockPush).toHaveBeenCalledWith('/admin/author/u1?postsPage=3', { scroll: false })
  })

  it('shows the range on the first page too, with no Previous', () => {
    render(
      <RelationshipTableClient
        {...props({
          total: 42,
          pagination: { offset: 0, nextHref: '/admin/author/u1?postsPage=2' },
        })}
      />,
    )

    expect(document.querySelector('[data-slot="relationship-table-footer"]')).toHaveTextContent(
      'Showing 1–2 of 42 rows',
    )
    expect(screen.queryByRole('link', { name: 'Previous page of Posts' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Next page of Posts' })).toBeInTheDocument()
  })

  it('offers no paging when every row fits', () => {
    render(<RelationshipTableClient {...props({ total: 2 })} />)

    expect(document.querySelector('[data-slot="relationship-table-footer"]')).toHaveTextContent(
      'Showing 2 of 2 rows',
    )
    expect(screen.queryByRole('link', { name: /page of Posts/ })).not.toBeInTheDocument()
  })

  it('moves to the last page when the page asked for is past the end', () => {
    render(
      <RelationshipTableClient
        {...props({
          rows: [],
          count: 0,
          total: 12,
          pagination: { offset: 40, lastPageHref: '/admin/author/u1?postsPage=2' },
        })}
      />,
    )

    expect(mockReplace).toHaveBeenCalledWith('/admin/author/u1?postsPage=2', { scroll: false })
  })
})
