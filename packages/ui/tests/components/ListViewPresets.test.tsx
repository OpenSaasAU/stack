import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/admin/post',
}))

const props: ListViewClientProps = {
  items: [{ id: '1', title: 'Draft one', status: 'draft' }],
  fieldTypes: { title: 'text', status: 'text' },
  relationshipRefs: {},
  columns: ['title', 'status'],
  availableColumns: ['title', 'status'],
  defaultColumns: ['title', 'status'],
  pageSizeControl: true,
  sortableFields: { title: true, status: true },
  listKey: 'Post',
  urlKey: 'post',
  basePath: '/admin',
  page: 1,
  pageSize: 50,
  total: 120,
  labelColumn: 'title',
  presets: [
    { key: 'drafts', label: 'Drafts' },
    { key: 'mine', label: 'My drafts' },
  ],
}

const onPreset: ListViewClientProps = {
  ...props,
  activePreset: 'mine',
  search: 'status:draft',
  initialSort: { field: 'title', direction: 'desc' },
}

function tabs() {
  return within(screen.getByRole('navigation', { name: 'Post views' })).getAllByRole('link')
}

beforeEach(() => {
  mockPush.mockClear()
  mockRefresh.mockClear()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('Preset view tabs', () => {
  it('shows an implicit All tab and each preset, with no counts', () => {
    render(<ListViewClient {...props} />)
    expect(tabs().map((tab) => tab.textContent)).toEqual(['All', 'Drafts', 'My drafts'])
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/admin/post?page=1')
    expect(screen.getByRole('link', { name: 'Drafts' })).toHaveAttribute(
      'href',
      '/admin/post?preset=drafts&page=1',
    )
  })

  it('marks the open preset and links back to the plain list', () => {
    render(<ListViewClient {...onPreset} />)
    expect(screen.getByRole('link', { name: 'My drafts' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/admin/post?page=1')
  })

  it('renders no tabs for a list without presets', () => {
    render(<ListViewClient {...props} presets={[]} />)
    expect(screen.queryByRole('navigation', { name: 'Post views' })).toBeNull()
  })

  it('shows the preset’s query as chips', () => {
    render(<ListViewClient {...onPreset} />)
    expect(screen.getByRole('button', { name: /^Remove .*draft/ })).toBeVisible()
  })
})

describe('the first edit on a preset', () => {
  it('expands a filter change to ?search= and drops the preset', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...onPreset} />)
    await user.type(screen.getByRole('combobox', { name: 'Filter post' }), 'hello')
    await user.click(screen.getByRole('option', { name: 'Search all text for “hello”' }))
    expect(mockPush).toHaveBeenCalledWith(
      '/admin/post?search=status%3Adraft+hello&sort=title%3Adesc&page=1',
    )
  })

  it('expands a sort change, keeping the preset’s query', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...onPreset} />)
    await user.click(screen.getByRole('button', { name: /^Title/ }))
    expect(mockPush).toHaveBeenCalledWith(
      '/admin/post?search=status%3Adraft&sort=title%3Aasc&page=1',
    )
  })

  it('expands a page size change', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...onPreset} />)
    await user.click(screen.getByRole('button', { name: '100' }))
    expect(mockPush).toHaveBeenCalledWith(
      '/admin/post?search=status%3Adraft&sort=title%3Adesc&page=1&pageSize=100',
    )
  })

  it('expands a column change', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...onPreset} />)
    await user.click(screen.getByRole('button', { name: 'Columns' }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Status' }))
    expect(mockPush).toHaveBeenCalledWith(
      '/admin/post?search=status%3Adraft&sort=title%3Adesc&page=1&columns=title',
    )
  })

  it('keeps the preset while paging', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...onPreset} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(mockPush).toHaveBeenCalledWith('/admin/post?preset=mine&sort=title%3Adesc&page=2')
  })
})
