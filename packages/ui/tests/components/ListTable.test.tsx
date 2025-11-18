import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListTable } from '../../src/components/standalone/ListTable.js'

describe('ListTable', () => {
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
  }

  describe('rendering', () => {
    it('should render all items in table', () => {
      render(<ListTable {...defaultProps} />)

      expect(screen.getByText('First Post')).toBeInTheDocument()
      expect(screen.getByText('Second Post')).toBeInTheDocument()
      expect(screen.getByText('Third Post')).toBeInTheDocument()
    })

    it('should render column headers', () => {
      render(<ListTable {...defaultProps} />)

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Views')).toBeInTheDocument()
    })

    it('should show empty state when no items', () => {
      render(<ListTable {...defaultProps} items={[]} />)

      expect(screen.getByText('No items found')).toBeInTheDocument()
    })

    it('should show custom empty message', () => {
      render(<ListTable {...defaultProps} items={[]} emptyMessage="No posts available" />)

      expect(screen.getByText('No posts available')).toBeInTheDocument()
    })

    it('should only render specified columns when provided', () => {
      render(<ListTable {...defaultProps} columns={['title', 'status']} />)

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.queryByText('Views')).not.toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(<ListTable {...defaultProps} className="custom-class" />)

      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('should sort items ascending when header clicked', async () => {
      const user = userEvent.setup()
      render(<ListTable {...defaultProps} />)

      await user.click(screen.getByText('Title'))

      const rows = screen.getAllByRole('row')
      expect(rows[1]).toHaveTextContent('First Post')
      expect(rows[2]).toHaveTextContent('Second Post')
      expect(rows[3]).toHaveTextContent('Third Post')
    })

    it('should toggle sort order when same header clicked twice', async () => {
      const user = userEvent.setup()
      render(<ListTable {...defaultProps} />)

      const titleHeader = screen.getByText('Title')
      await user.click(titleHeader)
      await user.click(titleHeader)

      const rows = screen.getAllByRole('row')
      expect(rows[1]).toHaveTextContent('Third Post')
      expect(rows[2]).toHaveTextContent('Second Post')
      expect(rows[3]).toHaveTextContent('First Post')
    })

    it('should show sort indicator on active column', async () => {
      const user = userEvent.setup()
      render(<ListTable {...defaultProps} />)

      await user.click(screen.getByText('Title'))

      expect(screen.getByText('↑')).toBeInTheDocument()
    })

    it('should not sort when sortable is false', async () => {
      const user = userEvent.setup()
      render(<ListTable {...defaultProps} sortable={false} />)

      await user.click(screen.getByText('Title'))

      // Should not show sort indicator
      expect(screen.queryByText('↑')).not.toBeInTheDocument()
    })

    it('should not show hover effect on headers when sortable is false', () => {
      render(<ListTable {...defaultProps} sortable={false} />)

      const titleHeader = screen.getByText('Title')
      const headerCell = titleHeader.closest('th')
      expect(headerCell).not.toHaveClass('cursor-pointer')
    })
  })

  describe('row interactions', () => {
    it('should call onRowClick when row clicked', async () => {
      const onRowClick = vi.fn()
      const user = userEvent.setup()

      render(<ListTable {...defaultProps} onRowClick={onRowClick} />)

      const rows = screen.getAllByRole('row')
      await user.click(rows[1]) // Click first data row (skip header)

      expect(onRowClick).toHaveBeenCalledWith(defaultProps.items[0])
    })

    it('should add cursor-pointer class when onRowClick provided', () => {
      const onRowClick = vi.fn()
      render(<ListTable {...defaultProps} onRowClick={onRowClick} />)

      const rows = screen.getAllByRole('row')
      expect(rows[1]).toHaveClass('cursor-pointer')
    })

    it('should not add cursor-pointer class when onRowClick not provided', () => {
      render(<ListTable {...defaultProps} />)

      const rows = screen.getAllByRole('row')
      expect(rows[1]).not.toHaveClass('cursor-pointer')
    })
  })

  describe('custom actions', () => {
    it('should render actions column when renderActions provided', () => {
      const renderActions = () => <button>Delete</button>

      render(<ListTable {...defaultProps} renderActions={renderActions} />)

      expect(screen.getByText('Actions')).toBeInTheDocument()
      expect(screen.getAllByText('Delete')).toHaveLength(3)
    })

    it('should not render actions column when renderActions not provided', () => {
      render(<ListTable {...defaultProps} />)

      expect(screen.queryByText('Actions')).not.toBeInTheDocument()
    })

    it('should pass item to renderActions function', () => {
      const renderActions = vi.fn(() => <button>Delete</button>)

      render(<ListTable {...defaultProps} renderActions={renderActions} />)

      expect(renderActions).toHaveBeenCalledWith(defaultProps.items[0])
      expect(renderActions).toHaveBeenCalledWith(defaultProps.items[1])
      expect(renderActions).toHaveBeenCalledWith(defaultProps.items[2])
    })

    it('should not propagate click to row when action clicked', async () => {
      const onRowClick = vi.fn()
      const onActionClick = vi.fn()
      const user = userEvent.setup()

      const renderActions = () => <button onClick={onActionClick}>Delete</button>

      render(<ListTable {...defaultProps} onRowClick={onRowClick} renderActions={renderActions} />)

      const deleteButton = screen.getAllByText('Delete')[0]
      await user.click(deleteButton)

      expect(onActionClick).toHaveBeenCalled()
      expect(onRowClick).not.toHaveBeenCalled()
    })
  })

  describe('relationships', () => {
    it('should render relationship as link when relationshipRefs provided', () => {
      const items = [
        {
          id: '1',
          title: 'Post 1',
          author: { id: 'user-1', name: 'John Doe' },
        },
      ]

      render(
        <ListTable
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

    it('should use custom basePath in relationship links', () => {
      const items = [
        {
          id: '1',
          title: 'Post 1',
          author: { id: 'user-1', name: 'John Doe' },
        },
      ]

      render(
        <ListTable
          items={items}
          fieldTypes={{ title: 'text', author: 'relationship' }}
          relationshipRefs={{ author: 'User.posts' }}
          basePath="/custom"
          columns={['title', 'author']}
        />,
      )

      const authorLink = screen.getByRole('link', { name: 'John Doe' })
      expect(authorLink).toHaveAttribute('href', '/custom/user/user-1')
    })

    it('should render multiple relationships as comma-separated links', () => {
      const items = [
        {
          id: '1',
          title: 'Post 1',
          tags: [
            { id: 'tag-1', name: 'JavaScript' },
            { id: 'tag-2', name: 'TypeScript' },
          ],
        },
      ]

      const { container } = render(
        <ListTable
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

    it('should show dash for null relationship', () => {
      const items = [{ id: '1', title: 'Post 1', author: null }]

      render(
        <ListTable
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
        <ListTable
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

    it('should display relationship as text when relationshipRefs not provided', () => {
      const items = [
        {
          id: '1',
          title: 'Post 1',
          author: { id: 'user-1', name: 'John Doe' },
        },
      ]

      render(
        <ListTable
          items={items}
          fieldTypes={{ title: 'text', author: 'relationship' }}
          columns={['title', 'author']}
        />,
      )

      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'John Doe' })).not.toBeInTheDocument()
    })

    it('should not propagate relationship link click to row', async () => {
      const onRowClick = vi.fn()
      const user = userEvent.setup()

      const items = [
        {
          id: '1',
          title: 'Post 1',
          author: { id: 'user-1', name: 'John Doe' },
        },
      ]

      render(
        <ListTable
          items={items}
          fieldTypes={{ title: 'text', author: 'relationship' }}
          relationshipRefs={{ author: 'User.posts' }}
          columns={['title', 'author']}
          onRowClick={onRowClick}
        />,
      )

      const authorLink = screen.getByRole('link', { name: 'John Doe' })
      await user.click(authorLink)

      expect(onRowClick).not.toHaveBeenCalled()
    })
  })

  describe('field display values', () => {
    it('should display checkbox values as Yes/No', () => {
      const items = [
        { id: '1', title: 'Post 1', published: true },
        { id: '2', title: 'Post 2', published: false },
      ]

      render(
        <ListTable
          items={items}
          fieldTypes={{ title: 'text', published: 'checkbox' }}
          columns={['title', 'published']}
        />,
      )

      expect(screen.getByText('Yes')).toBeInTheDocument()
      expect(screen.getByText('No')).toBeInTheDocument()
    })

    it('should display timestamp values as formatted dates', () => {
      const items = [{ id: '1', title: 'Post 1', createdAt: '2024-01-01T12:00:00Z' }]

      render(
        <ListTable
          items={items}
          fieldTypes={{ title: 'text', createdAt: 'timestamp' }}
          columns={['title', 'createdAt']}
        />,
      )

      const cells = screen.getAllByRole('cell')
      const dateCell = cells.find((cell) => cell.textContent?.includes('2024'))
      expect(dateCell).toBeInTheDocument()
    })

    it('should display null/undefined values as dash', () => {
      const items = [{ id: '1', title: 'Post 1', description: null }]

      render(
        <ListTable
          items={items}
          fieldTypes={{ title: 'text', description: 'text' }}
          columns={['title', 'description']}
        />,
      )

      const cells = screen.getAllByRole('cell')
      const descCell = cells.find((cell) => cell.textContent === '-')
      expect(descCell).toBeInTheDocument()
    })
  })

  describe('column filtering', () => {
    it('should exclude password fields by default', () => {
      const items = [{ id: '1', username: 'john', password: 'secret123' }]

      render(<ListTable items={items} fieldTypes={{ username: 'text', password: 'password' }} />)

      expect(screen.getByText('Username')).toBeInTheDocument()
      expect(screen.queryByText('Password')).not.toBeInTheDocument()
    })

    it('should exclude createdAt and updatedAt by default', () => {
      const items = [
        {
          id: '1',
          title: 'Post 1',
          createdAt: '2024-01-01T12:00:00Z',
          updatedAt: '2024-01-02T12:00:00Z',
        },
      ]

      render(
        <ListTable
          items={items}
          fieldTypes={{
            title: 'text',
            createdAt: 'timestamp',
            updatedAt: 'timestamp',
          }}
        />,
      )

      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.queryByText('Created At')).not.toBeInTheDocument()
      expect(screen.queryByText('Updated At')).not.toBeInTheDocument()
    })

    it('should show createdAt and updatedAt when explicitly in columns', () => {
      const items = [
        {
          id: '1',
          title: 'Post 1',
          createdAt: '2024-01-01T12:00:00Z',
        },
      ]

      render(
        <ListTable
          items={items}
          fieldTypes={{ title: 'text', createdAt: 'timestamp' }}
          columns={['title', 'createdAt']}
        />,
      )

      expect(screen.getByText('Created At')).toBeInTheDocument()
    })
  })
})
