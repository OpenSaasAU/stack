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

type Action = (input: ServerActionInput) => Promise<unknown>

const items = [
  { id: '1', title: 'Draft one', status: 'draft' },
  { id: '2', title: 'Live one', status: 'published' },
]

function renderList(serverAction: Action, overrides: Partial<ListViewClientProps> = {}) {
  return render(
    <ListViewClient
      items={items}
      fieldTypes={{ title: 'text', status: 'text' }}
      relationshipRefs={{}}
      listKey="Post"
      urlKey="post"
      basePath="/admin"
      page={2}
      pageSize={2}
      total={6}
      labelColumn="title"
      canDelete
      serverAction={serverAction}
      bulkActions={[
        { key: 'publish', label: 'Publish' },
        { key: 'archive', label: 'Archive', destructive: true },
      ]}
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

async function selectBoth() {
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select Draft one' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select Live one' }))
}

function bar() {
  return screen.getByRole('toolbar', { name: 'Selection actions' })
}

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
  window.sessionStorage.clear()
})

describe('a bulk action that cannot reach the server', () => {
  it('says the delete result is unknown and refreshes', async () => {
    renderList(vi.fn<Action>(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await selectBoth()

    await userEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Delete 2 posts: the result is unknown — refresh to check',
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('says a custom action’s result is unknown and refreshes', async () => {
    renderList(vi.fn<Action>(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await selectBoth()

    await userEvent.click(within(bar()).getByRole('button', { name: 'Publish' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Publish: the result is unknown — refresh to check',
    )
    expect(refresh).toHaveBeenCalled()
  })
})

describe('the selection bar while a bulk action runs', () => {
  it('disables every control until the action finishes', async () => {
    const pending = deferred<unknown>()
    renderList(vi.fn<Action>(() => pending.promise))
    await selectBoth()

    await userEvent.click(within(bar()).getByRole('button', { name: 'Publish' }))

    for (const name of [/Publish/, /^Archive$/, /^Delete$/, /^Clear$/]) {
      expect(within(bar()).getByRole('button', { name })).toBeDisabled()
    }

    pending.resolve({ bulkAction: true, message: 'Published 2 of 2' })
    expect(await screen.findByText('Published 2 of 2')).toBeInTheDocument()
  })
})

describe('after a bulk action', () => {
  it('stays on the current page after a custom action', async () => {
    renderList(vi.fn<Action>(async () => ({ bulkAction: true, message: 'Published 2 of 2' })))
    await selectBoth()

    await userEvent.click(within(bar()).getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })

  it('stays on the current page after a delete', async () => {
    renderList(vi.fn<Action>(async () => ({ deleted: 2, total: 2 })))
    await selectBoth()

    await userEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent('2 of 2 deleted')
    expect(refresh).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})

describe('the confirmations use the list’s plural', () => {
  it('follows English plural rules', async () => {
    renderList(vi.fn<Action>(), { listKey: 'Category', urlKey: 'category' })
    await selectBoth()

    await userEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByText('Delete 2 categories')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await userEvent.click(within(bar()).getByRole('button', { name: 'Archive' }))
    expect(within(screen.getByRole('dialog')).getByText('Archive 2 categories')).toBeInTheDocument()
  })

  it('uses ui.plural when the list declares one', async () => {
    renderList(vi.fn<Action>(), { listKey: 'Person', urlKey: 'person', pluralLabel: 'People' })
    await selectBoth()

    await userEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))

    expect(
      within(screen.getByRole('dialog')).getByText(
        'Are you sure you want to delete 2 selected people? This action cannot be undone.',
      ),
    ).toBeInTheDocument()
  })

  it('keeps the singular for one row', async () => {
    renderList(vi.fn<Action>(), { listKey: 'Category', urlKey: 'category' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Draft one' }))

    await userEvent.click(within(bar()).getByRole('button', { name: 'Delete' }))

    expect(within(screen.getByRole('dialog')).getByText('Delete 1 category')).toBeInTheDocument()
  })
})

describe('the status line', () => {
  it('says a refused row delete may be gone or out of reach', async () => {
    renderList(vi.fn<Action>(async () => ({ deleted: 0, total: 1 })))

    await userEvent.click(screen.getByRole('button', { name: 'Actions for Draft one' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent(
      '“Draft one” not deleted. It may already be gone, or you may not have access.',
    )
  })

  it('can be dismissed', async () => {
    renderList(vi.fn<Action>(async () => ({ bulkAction: true, message: 'Published 2 of 2' })))
    await selectBoth()
    await userEvent.click(within(bar()).getByRole('button', { name: 'Publish' }))
    const status = await screen.findByRole('status')

    await userEvent.click(within(status).getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
