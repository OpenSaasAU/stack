import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import userEvent from '@testing-library/user-event'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'
import { DENSITY_STORAGE_KEY, storeDensity } from '../../src/lib/density.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/admin/post',
}))

const props: ListViewClientProps = {
  items: [
    { id: '1', title: 'First Post', status: 'published', views: 100, author: null },
    { id: '2', title: 'Second Post', status: 'draft', views: 50, author: null },
  ],
  fieldTypes: { title: 'text', status: 'select', views: 'integer', author: 'relationship' },
  relationshipRefs: { author: 'User.posts' },
  columns: ['title', 'status'],
  availableColumns: ['title', 'status', 'views', 'author'],
  sortableFields: { title: true, status: true, views: true, author: false },
  listKey: 'Post',
  urlKey: 'post',
  basePath: '/admin',
  page: 2,
  pageSize: 50,
  total: 120,
  labelColumn: 'title',
}

beforeEach(() => {
  mockPush.mockClear()
  mockRefresh.mockClear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('column picker', () => {
  it('adds a column by writing ?columns=, keeping the page', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} />)

    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Views' }))

    expect(mockPush).toHaveBeenCalledWith('/admin/post?page=2&columns=title%2Cstatus%2Cviews')
  })

  it('shows the displayed columns checked and removes one on uncheck', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} />)

    await user.click(screen.getByRole('button', { name: 'Columns' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Status' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemcheckbox', { name: 'Author' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }))

    expect(mockPush).toHaveBeenCalledWith('/admin/post?page=2&columns=title')
  })

  it('never lets the last column be hidden', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} columns={['title']} />)

    await user.click(screen.getByRole('button', { name: 'Columns' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Title' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('carries a chosen column set through paging, sorting and filtering', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} columns={['status', 'title']} columnsChosen />)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(mockPush).toHaveBeenLastCalledWith('/admin/post?page=3&columns=status%2Ctitle')

    await user.click(
      within(screen.getByRole('columnheader', { name: 'Title' })).getByRole('button'),
    )
    expect(mockPush).toHaveBeenLastCalledWith(
      '/admin/post?sort=title%3Aasc&page=1&columns=status%2Ctitle',
    )
  })

  it('leaves the default column set out of the URL', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} />)

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(mockPush).toHaveBeenLastCalledWith('/admin/post?page=3')
  })

  it('keeps both of two columns ticked before navigation lands', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} />)

    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Views' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Author' }))

    expect(screen.getByRole('menuitemcheckbox', { name: 'Views' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(mockPush).toHaveBeenLastCalledWith(
      '/admin/post?page=2&columns=title%2Cstatus%2Cviews%2Cauthor',
    )
  })

  it('offers a reset only once columns were chosen', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ListViewClient {...props} />)
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    expect(screen.queryByRole('menuitem', { name: 'Reset columns' })).not.toBeInTheDocument()
    unmount()

    render(<ListViewClient {...props} columns={['views']} columnsChosen />)
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(screen.getByRole('menuitem', { name: 'Reset columns' }))
    expect(mockPush).toHaveBeenCalledWith('/admin/post?page=2')
  })
})

describe('toolbar sort control', () => {
  it('sorts by a chosen column from the toolbar, starting ascending', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} />)

    await user.click(screen.getByRole('button', { name: 'Sort' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Status' }))

    expect(mockPush).toHaveBeenCalledWith('/admin/post?sort=status%3Aasc&page=1')
  })

  it('flips the direction of the active sort, which the header shows too', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} initialSort={{ field: 'title', direction: 'asc' }} />)

    expect(screen.getByRole('columnheader', { name: /Title/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await user.click(screen.getByRole('button', { name: 'Sort: Title, ascending' }))
    expect(screen.getByRole('menuitemradio', { name: 'Title' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'Descending' }))

    expect(mockPush).toHaveBeenCalledWith('/admin/post?sort=title%3Adesc&page=1')
  })

  it('stays on the current page when the active field or direction is picked again', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} initialSort={{ field: 'title', direction: 'asc' }} />)

    await user.click(screen.getByRole('button', { name: 'Sort: Title, ascending' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Title' }))
    await user.click(screen.getByRole('button', { name: 'Sort: Title, ascending' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Ascending' }))

    expect(mockPush).not.toHaveBeenCalled()
  })

  it('offers only displayed columns the server marked sortable, never a relationship', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} columns={['title', 'author']} />)

    await user.click(screen.getByRole('button', { name: 'Sort' }))
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Title',
      'Ascending',
      'Descending',
    ])
  })

  it('is absent when nothing on screen can sort', () => {
    render(<ListViewClient {...props} sortableFields={{}} />)
    expect(screen.queryByRole('button', { name: /^Sort/ })).not.toBeInTheDocument()
  })
})

describe('density', () => {
  it('starts comfortable and remembers compact in this browser', async () => {
    const user = userEvent.setup()
    const { container } = render(<ListViewClient {...props} />)
    const group = screen.getByRole('group', { name: 'Row density' })
    const table = container.querySelector('[data-slot="list-view-table"]')

    expect(within(group).getByRole('button', { name: 'Comfortable' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(table).toHaveAttribute('data-density', 'comfortable')

    await user.click(within(group).getByRole('button', { name: 'Compact' }))

    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact')
    expect(table).toHaveAttribute('data-density', 'compact')
    expect(screen.getByText('First Post').closest('td')).toHaveClass('py-1.5')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('applies a choice when this browser refuses to store it', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
    try {
      const { container } = render(<ListViewClient {...props} />)
      await user.click(screen.getByRole('button', { name: 'Compact' }))

      expect(container.querySelector('[data-slot="list-view-table"]')).toHaveAttribute(
        'data-density',
        'compact',
      )
      expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBeNull()
    } finally {
      setItem.mockRestore()
      storeDensity('comfortable')
    }
  })

  it('restores a remembered density on mount', () => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'compact')
    render(<ListViewClient {...props} />)

    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'cosy')
    render(<ListViewClient {...props} />)

    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('renders comfortable on the server whatever this browser remembers', () => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'compact')
    const html = renderToString(<ListViewClient {...props} />)

    expect(html).toContain('data-density="comfortable"')
  })
})

describe('page sizes', () => {
  it('offers 25, 50 and 100 with the current size pressed', () => {
    render(<ListViewClient {...props} />)
    const group = screen.getByRole('group', { name: 'Rows per page' })

    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['25', '50', '100'])
    expect(within(group).getByRole('button', { name: '50' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('changes the page size from page 1, leaving the default out of the URL', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<ListViewClient {...props} />)
    await user.click(screen.getByRole('button', { name: '100' }))
    expect(mockPush).toHaveBeenLastCalledWith('/admin/post?page=1&pageSize=100')
    unmount()

    render(<ListViewClient {...props} pageSize={25} />)
    await user.click(screen.getByRole('button', { name: '50' }))
    expect(mockPush).toHaveBeenLastCalledWith('/admin/post?page=1')
  })

  it('shows the size control on a single page of results', () => {
    render(<ListViewClient {...props} page={1} total={2} />)

    expect(screen.getByRole('group', { name: 'Rows per page' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })
})

describe('selection rules', () => {
  const selectable = { ...props, canDelete: true, page: 1, total: 2 }

  it('keeps the selection when the columns or page size change', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ListViewClient {...selectable} />)
    await user.click(screen.getByRole('checkbox', { name: 'Select First Post' }))

    rerender(<ListViewClient {...selectable} columns={['title', 'views']} columnsChosen />)
    expect(screen.getByRole('checkbox', { name: 'Select First Post' })).toBeChecked()

    rerender(<ListViewClient {...selectable} pageSize={25} />)
    expect(screen.getByRole('checkbox', { name: 'Select First Post' })).toBeChecked()
  })

  it('clears the selection when the filter changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ListViewClient {...selectable} />)
    await user.click(screen.getByRole('checkbox', { name: 'Select First Post' }))

    rerender(<ListViewClient {...selectable} search="status:draft" />)
    expect(screen.getByRole('checkbox', { name: 'Select First Post' })).not.toBeChecked()
  })
})
