import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FilterFieldSuggestion } from '@opensaas/stack-core'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/admin/post',
}))

const suggestions: FilterFieldSuggestion[] = [
  { field: 'title', operators: ['eq'], freeText: true, valueSource: { kind: 'none' } },
  {
    field: 'status',
    operators: ['eq'],
    freeText: false,
    valueSource: {
      kind: 'enum',
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'published', label: 'Published' },
        { value: 'in review', label: 'In review' },
      ],
    },
    canBeEmpty: true,
  },
  {
    field: 'author',
    operators: ['eq'],
    freeText: false,
    valueSource: { kind: 'relationship', listKey: 'User', many: false },
    matchesById: true,
    canBeEmpty: true,
  },
]

const props: ListViewClientProps = {
  items: [
    {
      id: '1',
      title: 'First',
      status: 'draft',
      views: 3,
      author: { id: 'u1', label: 'Ada Lovelace' },
    },
    { id: '2', title: 'Second', status: 'in review', views: 9, author: null },
  ],
  fieldTypes: { title: 'text', status: 'select', views: 'integer', author: 'relationship' },
  relationshipRefs: { author: 'User.posts' },
  columns: ['title', 'status', 'views', 'author'],
  availableColumns: ['title', 'status', 'views', 'author'],
  defaultColumns: ['title', 'status', 'views', 'author'],
  sortableFields: { title: true, status: true, views: true, author: false },
  listKey: 'Post',
  urlKey: 'post',
  basePath: '/admin',
  page: 1,
  pageSize: 50,
  total: 2,
  labelColumn: 'title',
  filterSuggestions: suggestions,
}

beforeEach(() => {
  mockPush.mockClear()
  mockRefresh.mockClear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

function lastSearch(): string | null {
  const url = mockPush.mock.lastCall?.[0]
  if (typeof url !== 'string') return null
  return new URL(url, 'http://test').searchParams.get('search')
}

describe('header funnels', () => {
  it('offers a funnel only on filterable columns', () => {
    render(<ListViewClient {...props} />)
    expect(screen.getByRole('button', { name: 'Filter by Status' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter by Author' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Filter by Views' })).toBeNull()
  })

  it('starts a filter on that field in the Filter builder, from the keyboard too', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} />)

    screen.getByRole('button', { name: 'Filter by Status' }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('combobox', { name: 'Filter post' })).toHaveFocus()
    const values = screen.getByRole('listbox', { name: 'Status values' })
    expect(within(values).getByRole('option', { name: 'Draft' })).toBeInTheDocument()

    await user.click(within(values).getByRole('option', { name: 'Published' }))
    expect(lastSearch()).toBe('status:published')
  })
})

describe('value funnels', () => {
  it('filters to an enum value, quoting it where the grammar needs', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} />)

    await user.click(screen.getByRole('button', { name: 'Filter to Status is Draft' }))
    expect(lastSearch()).toBe('status:draft')

    await user.click(screen.getByRole('button', { name: 'Filter to Status is In review' }))
    expect(lastSearch()).toBe('status:"in review"')
  })

  it('filters to exactly the related record by id', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} />)

    await user.click(screen.getByRole('button', { name: 'Filter to Author is Ada Lovelace' }))
    expect(lastSearch()).toBe('author:#u1')
  })

  it('adds to the current query, replacing an earlier choice on the same field', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...props} search="first status:published" />)

    await user.click(screen.getByRole('button', { name: 'Filter to Author is Ada Lovelace' }))
    expect(lastSearch()).toBe('first status:published author:#u1')

    await user.click(screen.getByRole('button', { name: 'Filter to Status is Draft' }))
    expect(lastSearch()).toBe('first status:draft')
  })

  it('expands an open preset rather than losing its rows', async () => {
    const user = userEvent.setup()
    render(
      <ListViewClient
        {...props}
        presets={[{ key: 'drafts', label: 'Drafts' }]}
        activePreset="drafts"
        search="status:draft"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Filter to Author is Ada Lovelace' }))
    expect(mockPush).toHaveBeenLastCalledWith(
      '/admin/post?search=status%3Adraft+author%3A%23u1&page=1',
    )
  })

  it('offers none on an empty value, a non-enum field, the title column, or an unfilterable field', () => {
    render(
      <ListViewClient
        {...props}
        filterSuggestions={suggestions.filter((suggestion) => suggestion.field !== 'author')}
      />,
    )
    const funnels = screen
      .getAllByRole('button', { name: /^Filter to / })
      .map((button) => button.getAttribute('aria-label'))
    expect(funnels).toEqual(['Filter to Status is Draft', 'Filter to Status is In review'])
  })
})

describe('auto-shown columns', () => {
  it('never writes a column the filter showed to ?columns=', async () => {
    const user = userEvent.setup()
    render(
      <ListViewClient
        {...props}
        columns={['title', 'views', 'status']}
        autoColumns={['status']}
        columnsChosen
        search="status:draft"
        total={120}
      />,
    )

    expect(screen.getByRole('columnheader', { name: /^Status/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(mockPush).toHaveBeenLastCalledWith(
      `/admin/post?search=status%3Adraft&page=2&columns=title%2Cviews`,
    )
  })

  it('shows the filtered column ticked and locked in the picker', async () => {
    const user = userEvent.setup()
    render(
      <ListViewClient
        {...props}
        columns={['title', 'status']}
        defaultColumns={['title']}
        autoColumns={['status']}
        search="status:draft"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Columns' }))
    const status = screen.getByRole('menuitemcheckbox', { name: 'Status' })
    expect(status).toHaveAttribute('aria-checked', 'true')
    expect(status).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Views' }))
    expect(mockPush).toHaveBeenLastCalledWith(
      `/admin/post?search=status%3Adraft&page=1&columns=title%2Cviews`,
    )
  })
})

describe('the zero-results empty state', () => {
  const empty: ListViewClientProps = {
    ...props,
    items: [],
    total: 0,
    search: 'first status:draft author:#u1',
    recordLabels: { author: [{ id: 'u1', label: 'Ada Lovelace' }] },
  }

  it('names the term to remove, with its chip text and the rows it returns', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...empty} filterRemoval={{ start: 2, count: 1, rows: 12 }} />)

    await user.click(
      screen.getByRole('button', { name: 'Remove “Author is Ada Lovelace” to see 12 rows' }),
    )
    expect(lastSearch()).toBe('first status:draft')
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('says one row in the singular', () => {
    render(<ListViewClient {...empty} filterRemoval={{ start: 1, count: 1, rows: 1 }} />)
    expect(
      screen.getByRole('button', { name: 'Remove “Status is Draft” to see 1 row' }),
    ).toBeInTheDocument()
  })

  it('offers only Clear filters when no single term helps', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...empty} filterRemoval={null} />)

    expect(screen.queryByRole('button', { name: /^Remove “/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(mockPush).toHaveBeenLastCalledWith('/admin/post?page=1')
  })

  it('ignores a removal that names no term of the query on screen', () => {
    render(<ListViewClient {...empty} filterRemoval={{ start: 7, count: 1, rows: 3 }} />)
    expect(screen.queryByRole('button', { name: /^Remove “/ })).toBeNull()
  })
})
