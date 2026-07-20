import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListViewClient } from '../../src/components/ListViewClient.js'
import { BulkActions } from '../../src/components/BulkActions.js'

// Mock Next.js navigation — capture push/refresh so we can assert the refresh
// after a custom bulk action without a real router.
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/admin/post',
}))

const page1 = [
  { id: '1', title: 'First Post' },
  { id: '2', title: 'Second Post' },
]

const baseProps = {
  fieldTypes: { title: 'text' },
  relationshipRefs: {},
  listKey: 'Post',
  urlKey: 'post',
  basePath: '/admin',
  page: 1,
  pageSize: 2,
  total: 2,
}

beforeEach(() => {
  mockPush.mockClear()
  mockRefresh.mockClear()
  window.sessionStorage.clear()
})
afterEach(() => cleanup())

describe('BulkActions (standalone)', () => {
  it('renders one button per action in declaration order', () => {
    render(
      <BulkActions
        actions={[
          { key: 'publish', label: 'Publish' },
          { key: 'archive', label: 'Archive' },
        ]}
        onRun={vi.fn(async () => {})}
        count={2}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons[0]).toHaveTextContent('Publish')
    expect(buttons[1]).toHaveTextContent('Archive')
    // Each carries the named Slot for theming/targeting.
    expect(buttons[0]).toHaveAttribute('data-slot', 'selection-action')
    expect(buttons[0]).toHaveAttribute('data-action-key', 'publish')
  })

  it('runs a non-destructive action immediately without confirmation', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn(async () => {})
    render(<BulkActions actions={[{ key: 'publish', label: 'Publish' }]} onRun={onRun} count={1} />)

    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onRun).toHaveBeenCalledWith('publish')
  })

  it('confirms before running a destructive action', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn(async () => {})
    render(
      <BulkActions
        actions={[{ key: 'purge', label: 'Purge', destructive: true, variant: 'destructive' }]}
        onRun={onRun}
        count={2}
        itemName="post"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Purge' }))
    // Not run yet — a confirmation dialog appears first.
    expect(onRun).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Purge' }))

    expect(onRun).toHaveBeenCalledWith('purge')
  })

  it('renders nothing when there are no actions', () => {
    const { container } = render(<BulkActions actions={[]} onRun={vi.fn()} count={0} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ListViewClient custom bulk actions (#736)', () => {
  const bulkActions = [{ key: 'publish', label: 'Publish' }]

  it('enables selection when custom actions exist even if delete is denied', async () => {
    const user = userEvent.setup()
    render(
      <ListViewClient
        {...baseProps}
        items={page1}
        canDelete={false}
        bulkActions={bulkActions}
        serverAction={vi.fn()}
      />,
    )

    // The widened gate: selection turns on for a list with custom actions.
    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    const bar = screen.getByRole('toolbar', { name: /selection/i })
    expect(within(bar).getByText('1 selected')).toBeInTheDocument()
    // The custom action button shows in the selection-actions region…
    expect(within(bar).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    // …and Delete is NOT offered (delete denied).
    expect(within(bar).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('dispatches the action by key over the selected ids and reports the outcome', async () => {
    const user = userEvent.setup()
    const serverAction = vi.fn(async (input: { action: string; key?: string; ids?: string[] }) => {
      if (input.action === 'bulkAction') return { bulkAction: true, message: 'Published 2 of 2' }
      return { success: false, error: 'unexpected' }
    })

    render(
      <ListViewClient
        {...baseProps}
        items={page1}
        canDelete={false}
        bulkActions={bulkActions}
        serverAction={serverAction}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: /select all rows on this page/i }))
    const bar = screen.getByRole('toolbar', { name: /selection/i })
    await user.click(within(bar).getByRole('button', { name: 'Publish' }))

    // Exactly one secured round-trip carrying the action key + selected ids.
    expect(serverAction).toHaveBeenCalledTimes(1)
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'bulkAction',
      key: 'publish',
      ids: ['1', '2'],
    })

    // The handler's message is surfaced in the persisted status line…
    const status = await screen.findByText('Published 2 of 2')
    expect(status).toHaveAttribute('data-slot', 'selection-status')
    expect(mockRefresh).toHaveBeenCalled()
    // …and the selection is cleared afterwards.
    expect(screen.queryByRole('toolbar', { name: /selection/i })).not.toBeInTheDocument()
  })

  it('surfaces a handler error without leaking which rows were denied', async () => {
    const user = userEvent.setup()
    const serverAction = vi.fn(async () => ({ bulkAction: false, error: 'Access denied' }))

    render(
      <ListViewClient
        {...baseProps}
        items={page1}
        canDelete={false}
        bulkActions={bulkActions}
        serverAction={serverAction}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('Access denied')).toBeInTheDocument()
  })

  it('confirms a destructive custom action before dispatching', async () => {
    const user = userEvent.setup()
    const serverAction = vi.fn(async () => ({ bulkAction: true, message: 'done' }))

    render(
      <ListViewClient
        {...baseProps}
        items={page1}
        canDelete={false}
        bulkActions={[{ key: 'purge', label: 'Purge', destructive: true }]}
        serverAction={serverAction}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    await user.click(screen.getByRole('button', { name: 'Purge' }))
    // Nothing dispatched until the confirmation is accepted.
    expect(serverAction).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Purge' }))

    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'bulkAction',
      key: 'purge',
      ids: ['1'],
    })
  })

  it('does not render custom actions when no serverAction is wired', async () => {
    const user = userEvent.setup()
    render(
      <ListViewClient {...baseProps} items={page1} canDelete={false} bulkActions={bulkActions} />,
    )

    // Selection is still enabled (widened gate), but with no server action the
    // custom buttons cannot run, so they are not shown.
    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    const bar = screen.getByRole('toolbar', { name: /selection/i })
    expect(within(bar).queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
  })
})
