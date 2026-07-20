import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListViewClient } from '../../src/components/ListViewClient.js'
import { isPageFullySelected, getPageCheckboxState } from '../../src/lib/useRowSelection.js'

// Mock Next.js navigation — capture push/refresh so we can assert refresh after
// a bulk delete without a real router.
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

const page1 = [
  { id: '1', title: 'First Post' },
  { id: '2', title: 'Second Post' },
]
const page2 = [
  { id: '3', title: 'Third Post' },
  { id: '4', title: 'Fourth Post' },
]

const baseProps = {
  fieldTypes: { title: 'text' },
  relationshipRefs: {},
  listKey: 'Post',
  urlKey: 'post',
  basePath: '/admin',
  page: 1,
  pageSize: 2,
  total: 4,
}

beforeEach(() => {
  mockPush.mockClear()
  mockRefresh.mockClear()
  window.sessionStorage.clear()
})

describe('selection helpers', () => {
  it('isPageFullySelected is false for an empty page and true only when all present', () => {
    expect(isPageFullySelected(new Set(['1']), [])).toBe(false)
    expect(isPageFullySelected(new Set(['1']), ['1', '2'])).toBe(false)
    expect(isPageFullySelected(new Set(['1', '2']), ['1', '2'])).toBe(true)
  })

  it('getPageCheckboxState reflects none / some / all selected', () => {
    expect(getPageCheckboxState(new Set(), ['1', '2'])).toBe(false)
    expect(getPageCheckboxState(new Set(['1']), ['1', '2'])).toBe('indeterminate')
    expect(getPageCheckboxState(new Set(['1', '2']), ['1', '2'])).toBe(true)
  })
})

describe('ListViewClient row selection', () => {
  it('does not render selection checkboxes when canDelete is false', () => {
    render(<ListViewClient {...baseProps} items={page1} canDelete={false} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('toolbar', { name: /selection/i })).not.toBeInTheDocument()
  })

  it('per-row checkbox selects one row and shows the count', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...baseProps} items={page1} canDelete />)

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))

    const bar = screen.getByRole('toolbar', { name: /selection/i })
    expect(within(bar).getByText('1 selected')).toBeInTheDocument()
  })

  it('header checkbox toggles the whole visible page', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...baseProps} items={page1} canDelete />)

    const header = screen.getByRole('checkbox', { name: /select all rows on this page/i })
    await user.click(header)

    const bar = screen.getByRole('toolbar', { name: /selection/i })
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()

    // Clicking again clears the page.
    await user.click(header)
    expect(screen.queryByRole('toolbar', { name: /selection/i })).not.toBeInTheDocument()
  })

  it('Clear empties the selection', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...baseProps} items={page1} canDelete />)

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    const bar = screen.getByRole('toolbar', { name: /selection/i })
    await user.click(within(bar).getByRole('button', { name: 'Clear' }))

    expect(screen.queryByRole('toolbar', { name: /selection/i })).not.toBeInTheDocument()
  })

  it('accumulates selection across pages (persists on remount, same filter)', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ListViewClient {...baseProps} items={page1} canDelete />)

    // Select a row on page 1, then simulate navigating to page 2 (remount with
    // the same list + filter but a different visible page).
    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    unmount()
    render(<ListViewClient {...baseProps} items={page2} page={2} canDelete />)

    // The prior page-1 selection is restored, then a page-2 row is added.
    await user.click(await screen.findByRole('checkbox', { name: 'Select row 4' }))
    const bar = screen.getByRole('toolbar', { name: /selection/i })
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()
  })

  it('clears the selection when the filter changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ListViewClient {...baseProps} items={page1} canDelete />)

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    // A new filter (search) resets the selection.
    rerender(<ListViewClient {...baseProps} items={page1} search="query" canDelete />)
    expect(screen.queryByRole('toolbar', { name: /selection/i })).not.toBeInTheDocument()
  })
})

describe('ListViewClient bulk delete', () => {
  it('reports "N of M deleted" and refreshes, absorbing per-row Silent failures', async () => {
    const user = userEvent.setup()
    // One bulkDelete round-trip: the server deleted 1 of the 2 attempted (the
    // other denied via Silent failure server-side) and reports the count.
    const serverAction = vi.fn(async (input: { action: string; ids?: string[] }) => {
      if (input.action === 'bulkDelete') return { deleted: 1, total: input.ids?.length ?? 0 }
      return { success: false, error: 'Access denied or operation failed' }
    })

    render(<ListViewClient {...baseProps} items={page1} canDelete serverAction={serverAction} />)

    await user.click(screen.getByRole('checkbox', { name: /select all rows on this page/i }))
    const bar = screen.getByRole('toolbar', { name: /selection/i })
    await user.click(within(bar).getByRole('button', { name: 'Delete' }))

    // Confirm in the dialog.
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    // Only the allowed row counted; report never says which. Target the report by
    // its Slot (the Delete button's spinner also uses role="status").
    const status = await screen.findByText('1 of 2 deleted')
    expect(status).toHaveAttribute('data-slot', 'selection-status')
    // One secured server round-trip with both selected ids; denials are absorbed
    // server-side into the count.
    expect(serverAction).toHaveBeenCalledTimes(1)
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'bulkDelete',
      ids: ['1', '2'],
    })
    expect(mockRefresh).toHaveBeenCalled()

    // Selection is cleared after the delete.
    expect(screen.queryByRole('toolbar', { name: /selection/i })).not.toBeInTheDocument()
  })

  it('does not offer Delete when serverAction is absent', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...baseProps} items={page1} canDelete />)

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }))
    const bar = screen.getByRole('toolbar', { name: /selection/i })
    expect(within(bar).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    // Clear is still available.
    expect(within(bar).getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    cleanup()
  })
})
