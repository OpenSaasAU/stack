import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ListViewClient } from '../../src/components/ListViewClient.js'

const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  usePathname: () => '/admin/post',
}))

const base = {
  fieldTypes: { title: 'text' },
  relationshipRefs: {},
  sortableFields: { title: true },
  listKey: 'Post',
  urlKey: 'post',
  basePath: '/admin',
  pageSize: 50,
  canCreate: true,
}

beforeEach(() => {
  push.mockClear()
  replace.mockClear()
})

describe('a page past the end of the list', () => {
  it('moves to the last page, keeping the rest of the query', async () => {
    render(
      <ListViewClient
        {...base}
        items={[]}
        page={99}
        pageSize={25}
        total={120}
        search="status:draft"
        initialSort={{ field: 'title', direction: 'desc' }}
      />,
    )

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    const target = new URL(replace.mock.calls[0][0], 'http://admin.test')
    expect(target.pathname).toBe('/admin/post')
    expect(target.searchParams.get('page')).toBe('5')
    expect(target.searchParams.get('pageSize')).toBe('25')
    expect(target.searchParams.get('search')).toBe('status:draft')
    expect(target.searchParams.get('sort')).toBe('title:desc')
  })

  it('moves to page 1 when the list is empty', async () => {
    render(<ListViewClient {...base} items={[]} page={3} total={0} />)

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(new URL(replace.mock.calls[0][0], 'http://admin.test').searchParams.get('page')).toBe(
      '1',
    )
  })

  it('never offers to create the first record, or a nonsense range, while it moves', () => {
    render(<ListViewClient {...base} items={[]} page={99} pageSize={25} total={120} />)

    expect(screen.queryByText('No items yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Showing 2451/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Page 99 of/)).not.toBeInTheDocument()
  })

  it('leaves an in-range page alone', () => {
    render(<ListViewClient {...base} items={[{ id: '1', title: 'Only' }]} page={1} total={1} />)

    expect(replace).not.toHaveBeenCalled()
  })

  it('leaves the first page of an empty list alone', () => {
    render(<ListViewClient {...base} items={[]} page={1} total={0} />)

    expect(replace).not.toHaveBeenCalled()
    expect(screen.getByText('No items yet')).toBeInTheDocument()
  })
})

describe('the total under a filter', () => {
  it('counts the filtered rows', () => {
    render(
      <ListViewClient
        {...base}
        items={Array.from({ length: 25 }, (_, i) => ({ id: String(i), title: `Draft ${i}` }))}
        page={1}
        pageSize={25}
        total={30}
        search="status:draft"
      />,
    )

    expect(screen.getByText(/Showing 1 to 25 of 30/)).toBeInTheDocument()
  })
})
