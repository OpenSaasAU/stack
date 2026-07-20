import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListViewClient } from '../../src/components/ListViewClient.js'

// Mock Next.js navigation
const mockPush = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => '/admin/post',
}))

describe('ListViewClient', () => {
  const defaultProps = {
    items: [
      { id: '1', title: 'First Post', status: 'published', views: 100 },
      { id: '2', title: 'Second Post', status: 'draft', views: 50 },
      { id: '3', title: 'Third Post', status: 'published', views: 200 },
    ],
    fieldTypes: {
      title: 'text',
      status: 'select',
      views: 'integer',
    },
    relationshipRefs: {},
    listKey: 'Post',
    urlKey: 'post',
    basePath: '/admin',
    page: 1,
    pageSize: 50,
    total: 3,
  }

  beforeEach(() => {
    mockPush.mockClear()
  })

  describe('rendering', () => {
    it('should render all items in table', () => {
      render(<ListViewClient {...defaultProps} />)

      expect(screen.getByText('First Post')).toBeInTheDocument()
      expect(screen.getByText('Second Post')).toBeInTheDocument()
      expect(screen.getByText('Third Post')).toBeInTheDocument()
    })

    it('should render column headers', () => {
      render(<ListViewClient {...defaultProps} />)

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Views')).toBeInTheDocument()
    })

    it('should render actions column', () => {
      render(<ListViewClient {...defaultProps} />)

      const editLinks = screen.getAllByText('Edit')
      expect(editLinks).toHaveLength(3)
    })

    it('should show a designed empty state when no items', () => {
      const { container } = render(<ListViewClient {...defaultProps} items={[]} total={0} />)

      // The empty cell now renders the designed EmptyState (data-slot contract).
      expect(container.querySelector('[data-slot="list-view-empty"]')).toBeInTheDocument()
      expect(container.querySelector('[data-slot="empty-state"]')).toBeInTheDocument()
      expect(screen.getByText('No items yet')).toBeInTheDocument()
    })

    it('should show a search-specific empty state when a search yields nothing', () => {
      render(<ListViewClient {...defaultProps} items={[]} total={0} search="nomatch" />)

      expect(screen.getByText('No matches found')).toBeInTheDocument()
      // Offers a way back out of the fruitless search.
      expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument()
    })

    it('should right-align numeric column cells and headers', () => {
      const { container } = render(
        <ListViewClient {...defaultProps} columns={['title', 'views']} />,
      )

      // Numeric header content is right-justified.
      const headers = container.querySelectorAll('[data-slot="table-head"]')
      const viewsHeader = Array.from(headers).find((h) => h.textContent?.includes('Views'))
      expect(viewsHeader?.querySelector('div')).toHaveClass('text-right')

      // Every numeric body cell is right-aligned; the text column is not.
      const bodyRows = container.querySelectorAll(
        '[data-slot="table-body"] [data-slot="table-row"]',
      )
      const firstRowCells = bodyRows[0].querySelectorAll('[data-slot="table-cell"]')
      // Column order: title (text), views (integer), then actions.
      expect(firstRowCells[0]).not.toHaveClass('text-right')
      expect(firstRowCells[1]).toHaveClass('text-right')
    })

    it('should only render specified columns when provided', () => {
      render(<ListViewClient {...defaultProps} columns={['title', 'status']} />)

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.queryByText('Views')).not.toBeInTheDocument()
    })

    it('should render columns in the provided order (initialColumns)', () => {
      // initialColumns flows through AdminUI as the `columns` prop and drives
      // both selection AND order.
      render(<ListViewClient {...defaultProps} columns={['views', 'title']} />)

      const headers = screen.getAllByRole('columnheader')
      // First two headers should follow the provided order, then Actions.
      expect(headers[0]).toHaveTextContent('Views')
      expect(headers[1]).toHaveTextContent('Title')
      expect(headers[2]).toHaveTextContent('Actions')
      // Unlisted column is excluded.
      expect(screen.queryByText('Status')).not.toBeInTheDocument()
    })
  })

  describe('initialSort', () => {
    it('should show sort indicator on the initialSort column (asc)', () => {
      render(
        <ListViewClient {...defaultProps} initialSort={{ field: 'title', direction: 'asc' }} />,
      )

      expect(screen.getByText('↑')).toBeInTheDocument()
    })

    it('should show sort indicator on the initialSort column (desc)', () => {
      render(
        <ListViewClient {...defaultProps} initialSort={{ field: 'title', direction: 'desc' }} />,
      )

      expect(screen.getByText('↓')).toBeInTheDocument()
    })

    it('should preserve item order provided by server (no in-memory sort)', () => {
      // Items arrive pre-sorted by the server; the client renders them as-is.
      const sortedItems = [
        { id: '3', title: 'Third Post', status: 'published', views: 200 },
        { id: '2', title: 'Second Post', status: 'draft', views: 50 },
        { id: '1', title: 'First Post', status: 'published', views: 100 },
      ]
      render(
        <ListViewClient
          {...defaultProps}
          items={sortedItems}
          initialSort={{ field: 'title', direction: 'desc' }}
        />,
      )

      const rows = screen.getAllByRole('row')
      expect(rows[1]).toHaveTextContent('Third Post')
      expect(rows[2]).toHaveTextContent('Second Post')
      expect(rows[3]).toHaveTextContent('First Post')
    })

    it('should not apply any default sort when initialSort is absent', () => {
      render(<ListViewClient {...defaultProps} />)

      // No sort indicator when no initialSort.
      expect(screen.queryByText('↑')).not.toBeInTheDocument()
      expect(screen.queryByText('↓')).not.toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('should navigate with sort param when column header clicked', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} />)

      await user.click(screen.getByText('Title'))

      expect(mockPush).toHaveBeenCalledWith('/admin/post?sort=title%3Aasc&page=1')
    })

    it('should navigate with toggled direction when already-sorted column clicked', async () => {
      const user = userEvent.setup()
      render(
        <ListViewClient {...defaultProps} initialSort={{ field: 'title', direction: 'asc' }} />,
      )

      await user.click(screen.getByText('Title'))

      expect(mockPush).toHaveBeenCalledWith('/admin/post?sort=title%3Adesc&page=1')
    })

    it('should show sort indicator on active column', async () => {
      render(
        <ListViewClient {...defaultProps} initialSort={{ field: 'title', direction: 'asc' }} />,
      )

      expect(screen.getByText('↑')).toBeInTheDocument()
    })

    it('should navigate with asc when switching to a different column', async () => {
      const user = userEvent.setup()
      render(
        <ListViewClient {...defaultProps} initialSort={{ field: 'title', direction: 'desc' }} />,
      )

      await user.click(screen.getByText('Views'))

      expect(mockPush).toHaveBeenCalledWith('/admin/post?sort=views%3Aasc&page=1')
    })
  })

  // The search UI is now the Filter builder (#731): a free-text box plus an
  // Apply/Clear affordance that writes the `?search=` filter query. These tests
  // pass no `filterSuggestions`, so only the free-text box is shown.
  describe('search (Filter builder free-text)', () => {
    it('should render search input', () => {
      render(<ListViewClient {...defaultProps} />)

      expect(screen.getByLabelText('Search')).toBeInTheDocument()
    })

    it('should update search input value', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} />)

      const searchInput = screen.getByLabelText('Search')
      await user.type(searchInput, 'test')

      expect(searchInput).toHaveValue('test')
    })

    it('should navigate with search query when Apply clicked', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} />)

      await user.type(screen.getByLabelText('Search'), 'test')
      await user.click(screen.getByRole('button', { name: 'Apply' }))

      expect(mockPush).toHaveBeenCalledWith('/admin/post?search=test&page=1')
    })

    it('should show a Clear button when search has value', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} />)

      await user.type(screen.getByLabelText('Search'), 'test')

      expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    })

    it('should clear search when Clear clicked (resets to page 1)', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} search="existing" />)

      await user.click(screen.getByRole('button', { name: 'Clear' }))

      expect(mockPush).toHaveBeenCalledWith('/admin/post?page=1')
    })

    it('should preserve active sort when search is cleared', async () => {
      const user = userEvent.setup()
      render(
        <ListViewClient
          {...defaultProps}
          search="existing"
          initialSort={{ field: 'title', direction: 'desc' }}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Clear' }))

      expect(mockPush).toHaveBeenCalledWith('/admin/post?sort=title%3Adesc&page=1')
    })

    it('should reset to page 1 when new search submitted', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} page={3} />)

      await user.type(screen.getByLabelText('Search'), 'test')
      await user.click(screen.getByRole('button', { name: 'Apply' }))

      expect(mockPush).toHaveBeenCalledWith('/admin/post?search=test&page=1')
    })

    it('should preserve initial search value', () => {
      render(<ListViewClient {...defaultProps} search="existing" />)

      expect(screen.getByLabelText('Search')).toHaveValue('existing')
    })
  })

  describe('pagination', () => {
    it('should show pagination when total pages > 1', () => {
      render(<ListViewClient {...defaultProps} total={100} pageSize={10} />)

      expect(screen.getByText(/Page 1 of 10/)).toBeInTheDocument()
    })

    it('should not show pagination when total pages = 1', () => {
      render(<ListViewClient {...defaultProps} total={3} pageSize={50} />)

      expect(screen.queryByText(/Page/)).not.toBeInTheDocument()
    })

    it('should show correct page info', () => {
      render(<ListViewClient {...defaultProps} total={100} pageSize={10} page={2} />)

      expect(screen.getByText(/Showing 11 to 20 of 100 results/)).toBeInTheDocument()
    })

    it('should disable Previous button on first page', () => {
      render(<ListViewClient {...defaultProps} total={100} pageSize={10} page={1} />)

      const prevButton = screen.getByRole('button', { name: /previous/i })
      expect(prevButton).toBeDisabled()
    })

    it('should disable Next button on last page', () => {
      render(<ListViewClient {...defaultProps} total={100} pageSize={10} page={10} />)

      const nextButton = screen.getByRole('button', { name: /next/i })
      expect(nextButton).toBeDisabled()
    })

    it('should navigate to previous page when Previous clicked', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} total={100} pageSize={10} page={2} />)

      const prevButton = screen.getByRole('button', { name: /previous/i })
      await user.click(prevButton)

      // A non-default pageSize is echoed into nav URLs so it survives paging.
      expect(mockPush).toHaveBeenCalledWith('/admin/post?page=1&pageSize=10')
    })

    it('should navigate to next page when Next clicked', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} total={100} pageSize={10} page={1} />)

      const nextButton = screen.getByRole('button', { name: /next/i })
      await user.click(nextButton)

      expect(mockPush).toHaveBeenCalledWith('/admin/post?page=2&pageSize=10')
    })

    it('should preserve search in pagination URLs', async () => {
      const user = userEvent.setup()
      render(<ListViewClient {...defaultProps} total={100} pageSize={10} page={1} search="test" />)

      const nextButton = screen.getByRole('button', { name: /next/i })
      await user.click(nextButton)

      expect(mockPush).toHaveBeenCalledWith('/admin/post?search=test&page=2&pageSize=10')
    })

    it('should preserve sort in pagination URLs', async () => {
      const user = userEvent.setup()
      render(
        <ListViewClient
          {...defaultProps}
          total={100}
          pageSize={10}
          page={1}
          initialSort={{ field: 'title', direction: 'desc' }}
        />,
      )

      const nextButton = screen.getByRole('button', { name: /next/i })
      await user.click(nextButton)

      expect(mockPush).toHaveBeenCalledWith('/admin/post?sort=title%3Adesc&page=2&pageSize=10')
    })
  })

  describe('relationships', () => {
    // Relationship values arrive pre-resolved to { id, label } — the server
    // component (ListView.tsx) computes `label` via the shared label seam
    // (getItemLabel) before crossing the server/client boundary.
    it('should render relationship as link when relationshipRefs provided', () => {
      const items = [
        {
          id: '1',
          title: 'Post 1',
          author: { id: 'user-1', label: 'John Doe' },
        },
      ]

      render(
        <ListViewClient
          {...defaultProps}
          items={items}
          fieldTypes={{ title: 'text', author: 'relationship' }}
          relationshipRefs={{ author: 'User.posts' }}
          columns={['title', 'author']}
        />,
      )

      const authorLink = screen.getByRole('link', { name: 'John Doe' })
      expect(authorLink).toBeInTheDocument()
      expect(authorLink).toHaveAttribute('href', '/admin/user/user-1')
    })

    it('should render multiple relationships as comma-separated links', () => {
      const items = [
        {
          id: '1',
          title: 'Post 1',
          tags: [
            { id: 'tag-1', label: 'JavaScript' },
            { id: 'tag-2', label: 'TypeScript' },
          ],
        },
      ]

      const { container } = render(
        <ListViewClient
          {...defaultProps}
          items={items}
          fieldTypes={{ title: 'text', tags: 'relationship' }}
          relationshipRefs={{ tags: 'Tag.posts' }}
          columns={['title', 'tags']}
        />,
      )

      expect(screen.getByRole('link', { name: 'JavaScript' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'TypeScript' })).toBeInTheDocument()
      // Check for comma separator in the container
      expect(container.textContent).toContain(', ')
    })

    it('should show dash for empty relationship', () => {
      const items = [{ id: '1', title: 'Post 1', author: null }]

      render(
        <ListViewClient
          {...defaultProps}
          items={items}
          fieldTypes={{ title: 'text', author: 'relationship' }}
          relationshipRefs={{ author: 'User.posts' }}
          columns={['title', 'author']}
        />,
      )

      const cells = screen.getAllByRole('cell')
      const authorCell = cells.find((cell) => cell.textContent === '-')
      expect(authorCell).toBeInTheDocument()
    })

    it('should show dash for empty relationship array', () => {
      const items = [{ id: '1', title: 'Post 1', tags: [] }]

      render(
        <ListViewClient
          {...defaultProps}
          items={items}
          fieldTypes={{ title: 'text', tags: 'relationship' }}
          relationshipRefs={{ tags: 'Tag.posts' }}
          columns={['title', 'tags']}
        />,
      )

      const cells = screen.getAllByRole('cell')
      const tagsCell = cells.find((cell) => cell.textContent === '-')
      expect(tagsCell).toBeInTheDocument()
    })
  })

  describe('field display values', () => {
    it('should display checkbox values as accessible marks (Yes/No)', () => {
      const items = [
        { id: '1', title: 'Post 1', published: true },
        { id: '2', title: 'Post 2', published: false },
      ]

      render(
        <ListViewClient
          {...defaultProps}
          items={items}
          fieldTypes={{ title: 'text', published: 'checkbox' }}
          columns={['title', 'published']}
        />,
      )

      // Checkbox Cells render a mark; the boolean survives as the accessible name.
      expect(screen.getByLabelText('Yes')).toBeInTheDocument()
      expect(screen.getByLabelText('No')).toBeInTheDocument()
    })

    it('should display timestamp values as formatted dates', () => {
      const items = [{ id: '1', title: 'Post 1', createdAt: '2024-01-01T12:00:00Z' }]

      render(
        <ListViewClient
          {...defaultProps}
          items={items}
          fieldTypes={{ title: 'text', createdAt: 'timestamp' }}
          columns={['title', 'createdAt']}
        />,
      )

      // Just check that it's formatted (not the exact format which depends on locale)
      const cells = screen.getAllByRole('cell')
      const dateCell = cells.find((cell) => cell.textContent?.includes('2024'))
      expect(dateCell).toBeInTheDocument()
    })
  })

  describe('edit links', () => {
    it('should link to correct edit page', () => {
      render(<ListViewClient {...defaultProps} />)

      const editLinks = screen.getAllByRole('link', { name: 'Edit' })
      expect(editLinks[0]).toHaveAttribute('href', '/admin/post/1')
      expect(editLinks[1]).toHaveAttribute('href', '/admin/post/2')
      expect(editLinks[2]).toHaveAttribute('href', '/admin/post/3')
    })

    it('should use custom basePath in edit links', () => {
      render(<ListViewClient {...defaultProps} basePath="/custom" />)

      const editLinks = screen.getAllByRole('link', { name: 'Edit' })
      expect(editLinks[0]).toHaveAttribute('href', '/custom/post/1')
    })
  })
})
