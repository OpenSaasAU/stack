import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'
import type { ServerActionInput } from '../../src/server/types.js'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/admin/post',
}))

const items = [
  { id: '1', title: 'Draft one', status: 'draft' },
  { id: '2', title: 'Live one', status: 'published' },
]

function renderList(
  serverAction: (input: ServerActionInput) => Promise<unknown> = vi.fn(async () => ({})),
  overrides: Partial<ListViewClientProps> = {},
) {
  return render(
    <ListViewClient
      items={items}
      fieldTypes={{ title: 'text', status: 'text' }}
      relationshipRefs={{}}
      listKey="Post"
      urlKey="post"
      basePath="/admin"
      page={1}
      pageSize={50}
      total={2}
      labelColumn="title"
      canDelete
      serverAction={serverAction}
      rowActions={[{ key: 'publish', label: 'Publish now', icon: 'send' }]}
      rowActionKeys={{ '1': ['publish'] }}
      {...overrides}
    />,
  )
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function trigger(name: string) {
  return screen.getByRole('button', { name: `Actions for ${name}` })
}

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
  window.sessionStorage.clear()
})

describe('Row actions', () => {
  it('opens, moves and closes by keyboard and returns focus to its trigger', async () => {
    const user = userEvent.setup()
    renderList()

    trigger('Draft one').focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    const entries = within(menu).getAllByRole('menuitem')
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'Edit',
      'Copy link',
      'Publish now',
      'Delete',
    ])

    await waitFor(() => expect(entries[0]).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(entries[1]).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger('Draft one')).toHaveFocus()
  })

  it('offers a custom action only on rows where it is available', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(trigger('Live one'))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Publish now' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/admin/post/2',
    )
  })

  it('dispatches the action by key and id and reports its outcome in the status line', async () => {
    const user = userEvent.setup()
    const serverAction = vi.fn(async () => ({ rowAction: true, message: 'Published' }))
    renderList(serverAction)

    await user.click(trigger('Draft one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Publish now' }))

    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'rowAction',
      key: 'publish',
      id: '1',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Published')
    expect(refresh).toHaveBeenCalled()
  })

  it('reports an action that was not run without saying why', async () => {
    const user = userEvent.setup()
    renderList(vi.fn(async () => ({ rowAction: false, error: 'This action was not run' })))

    await user.click(trigger('Draft one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Publish now' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Publish now: This action was not run',
    )
  })

  it('reports an action whose dispatch rejected as an unknown outcome and refreshes', async () => {
    const user = userEvent.setup()
    renderList(
      vi.fn(async () => {
        throw new Error('Failed to find Server Action')
      }),
    )

    await user.click(trigger('Draft one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Publish now' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Publish now: the result is unknown — refresh to check')
    expect(status).not.toHaveTextContent('not run')
    expect(refresh).toHaveBeenCalled()
  })

  it('reports a delete whose dispatch rejected as an unknown outcome and refreshes', async () => {
    const user = userEvent.setup()
    renderList(
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    await user.click(trigger('Live one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Delete “Live one”: the result is unknown — refresh to check')
    expect(status).not.toHaveTextContent('not deleted')
    expect(refresh).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('returns to the first page after deleting the last row on a later page', async () => {
    const user = userEvent.setup()
    renderList(
      vi.fn(async () => ({ deleted: 1, total: 1 })),
      { page: 2, total: 51, items: [{ id: '51', title: 'Last one', status: 'draft' }] },
    )

    await user.click(trigger('Last one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent('“Last one” deleted')
    expect(refresh).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/admin/post?page=1')
  })

  it('stays on the current page after a delete that leaves rows on it', async () => {
    const user = userEvent.setup()
    renderList(
      vi.fn(async () => ({ deleted: 1, total: 1 })),
      {
        page: 7,
        total: 1000,
        items: [
          { id: '301', title: 'Kept one', status: 'draft' },
          { id: '302', title: 'Gone one', status: 'draft' },
        ],
      },
    )

    await user.click(trigger('Gone one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent('“Gone one” deleted')
    expect(refresh).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('links the title beside a custom cell that renders its own anchor', () => {
    function WebsiteCell({ value }: { value: unknown }) {
      return <a href={String(value)}>{String(value)}</a>
    }
    const { container } = renderList(undefined, {
      items: [{ id: '1', website: 'https://example.com' }],
      fieldTypes: { website: 'text' },
      fields: { website: { type: 'text', ui: { cell: WebsiteCell } } },
      labelColumn: 'website',
      rowActionKeys: {},
    })

    expect(container.querySelector('a a')).toBeNull()
    const titleLink = container.querySelector('[data-slot="row-title-link"]')
    expect(titleLink).toHaveAttribute('href', '/admin/post/1')
    expect(titleLink).toHaveAccessibleName('Open https://example.com')
    expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
  })

  it('titles a list whose displayed columns are all relationships with an Open link', () => {
    const { container } = renderList(undefined, {
      listKey: 'Audition',
      urlKey: 'audition',
      items: [{ id: 'a1', student: { id: 's1', label: 'Sam' }, production: null }],
      fieldTypes: { student: 'relationship', production: 'relationship' },
      relationshipRefs: { student: 'Student', production: 'Production' },
      labelColumn: undefined,
      rowActionKeys: {},
    })

    const titleLink = container.querySelector('[data-slot="row-title-link"]')
    expect(titleLink).toHaveAttribute('href', '/admin/audition/a1')
    expect(titleLink).toHaveTextContent('Open')
    expect(container.querySelector('a a')).toBeNull()
  })

  it('never wraps a relationship title cell in the item link', () => {
    const { container } = renderList(undefined, {
      items: [{ id: '1', title: { id: 't1', label: 'Linked title' } }],
      fieldTypes: { title: 'relationship' },
      relationshipRefs: { title: 'Topic' },
      labelColumn: 'title',
      rowActionKeys: {},
    })

    expect(container.querySelector('a a')).toBeNull()
    const titleLink = container.querySelector('[data-slot="row-title-link"]')
    expect(titleLink).toHaveAttribute('href', '/admin/post/1')
    expect(titleLink).toHaveTextContent('Open')
  })

  it('says so when a Delete is confirmed while an action is still running', async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    const serverAction = vi.fn(() => pending.promise)
    renderList(serverAction)

    await user.click(trigger('Draft one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Publish now' }))
    await waitFor(() => expect(trigger('Draft one')).toHaveAttribute('aria-disabled', 'true'))

    await user.click(trigger('Draft one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Another action on “Draft one” is still running',
    )
    expect(serverAction).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(trigger('Draft one')).toHaveFocus())

    pending.resolve({ rowAction: true, message: 'Post published' })
    expect(await screen.findByRole('status')).toHaveTextContent('Post published')
  })

  it('wraps a built-in title cell in the item link', () => {
    const { container } = renderList()
    const titleLink = container.querySelector('[data-slot="row-title-link"]')
    expect(titleLink).toHaveAttribute('href', '/admin/post/1')
    expect(titleLink).toHaveTextContent('Draft one')
  })

  it('confirms Delete, and reports a denied delete as not deleted', async () => {
    const user = userEvent.setup()
    const serverAction = vi.fn(async () => ({ deleted: 0, total: 1 }))
    renderList(serverAction)

    await user.click(trigger('Live one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    expect(serverAction).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(serverAction).toHaveBeenCalledWith({ listKey: 'Post', action: 'bulkDelete', ids: ['2'] })
    expect(await screen.findByRole('status')).toHaveTextContent('“Live one” not deleted')
  })

  it('returns focus to the trigger when the delete confirmation is cancelled', async () => {
    const user = userEvent.setup()
    renderList()

    trigger('Live one').focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('menu')
    await user.keyboard('{End}{Enter}')

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(trigger('Live one')).toHaveFocus())
  })

  it('returns focus to the trigger after a confirmed Delete, while the delete is in flight', async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    renderList(vi.fn(() => pending.promise))

    trigger('Live one').focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('menu')
    await user.keyboard('{End}{Enter}')

    const dialog = await screen.findByRole('dialog')
    within(dialog).getByRole('button', { name: 'Delete' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger('Live one')).toHaveFocus())

    pending.resolve({ deleted: 1, total: 2 })
    expect(await screen.findByRole('status')).toHaveTextContent('“Live one” deleted')
    expect(trigger('Live one')).toHaveFocus()
  })

  it('returns focus to the trigger after a confirmed destructive action', async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    renderList(
      vi.fn(() => pending.promise),
      {
        rowActions: [{ key: 'archive', label: 'Archive', destructive: true }],
        rowActionKeys: { '1': ['archive'] },
      },
    )

    trigger('Draft one').focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    within(menu).getByRole('menuitem', { name: 'Archive' }).focus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog')
    within(dialog).getByRole('button', { name: 'Archive' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger('Draft one')).toHaveFocus())

    pending.resolve({ rowAction: true, message: 'Archived' })
    expect(await screen.findByRole('status')).toHaveTextContent('Archived')
    expect(trigger('Draft one')).toHaveFocus()
  })

  it('returns focus to the trigger after a non-destructive action', async () => {
    const user = userEvent.setup()
    const pending = deferred<unknown>()
    renderList(vi.fn(() => pending.promise))

    trigger('Draft one').focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    within(menu).getByRole('menuitem', { name: 'Publish now' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger('Draft one')).toHaveFocus())
    expect(trigger('Draft one')).toHaveAttribute('aria-disabled', 'true')

    pending.resolve({ rowAction: true, message: 'Published' })
    expect(await screen.findByRole('status')).toHaveTextContent('Published')
    expect(trigger('Draft one')).toHaveFocus()
    expect(trigger('Draft one')).not.toHaveAttribute('aria-disabled')
  })

  it('offers no Delete when the list cannot delete', async () => {
    const user = userEvent.setup()
    renderList(undefined, { canDelete: false })

    await user.click(trigger('Draft one'))
    const menu = await screen.findByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('copies the item link and says so', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderList()

    await user.click(trigger('Draft one'))
    await user.click(await screen.findByRole('menuitem', { name: 'Copy link' }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/admin/post/1`)
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied')
  })
})
