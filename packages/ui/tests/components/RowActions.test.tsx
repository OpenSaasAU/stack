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
