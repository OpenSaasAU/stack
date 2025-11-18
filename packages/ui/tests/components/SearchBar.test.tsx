import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from '../../src/components/standalone/SearchBar.js'

// Mock Next.js navigation
const mockPush = vi.fn()
const mockPathname = '/admin/posts'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => mockPathname,
}))

describe('SearchBar', () => {
  beforeEach(() => {
    mockPush.mockClear()
  })

  describe('rendering', () => {
    it('should render search input', () => {
      render(<SearchBar />)

      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
    })

    it('should render search button', () => {
      render(<SearchBar />)

      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    })

    it('should use custom placeholder', () => {
      render(<SearchBar placeholder="Search posts..." />)

      expect(screen.getByPlaceholderText('Search posts...')).toBeInTheDocument()
    })

    it('should use custom search button label', () => {
      render(<SearchBar searchLabel="Find" />)

      expect(screen.getByRole('button', { name: 'Find' })).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(<SearchBar className="custom-class" />)

      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })

    it('should show default value', () => {
      render(<SearchBar defaultValue="initial search" />)

      const input = screen.getByPlaceholderText('Search...')
      expect(input).toHaveValue('initial search')
    })
  })

  describe('user interactions', () => {
    it('should update input value when user types', async () => {
      const user = userEvent.setup()
      render(<SearchBar />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test query')

      expect(input).toHaveValue('test query')
    })

    it('should show clear button when input has value', async () => {
      const user = userEvent.setup()
      render(<SearchBar />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      expect(screen.getByText('✕')).toBeInTheDocument()
    })

    it('should not show clear button when input is empty', () => {
      render(<SearchBar />)

      expect(screen.queryByText('✕')).not.toBeInTheDocument()
    })

    it('should clear input when clear button clicked', async () => {
      const user = userEvent.setup()
      render(<SearchBar />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      const clearButton = screen.getByText('✕')
      await user.click(clearButton)

      expect(input).toHaveValue('')
    })

    it('should hide clear button after clearing', async () => {
      const user = userEvent.setup()
      render(<SearchBar />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      const clearButton = screen.getByText('✕')
      await user.click(clearButton)

      expect(screen.queryByText('✕')).not.toBeInTheDocument()
    })
  })

  describe('search functionality', () => {
    it('should call onSearch with trimmed query when search button clicked', async () => {
      const onSearch = vi.fn()
      const user = userEvent.setup()

      render(<SearchBar onSearch={onSearch} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, '  test query  ')

      const searchButton = screen.getByRole('button', { name: 'Search' })
      await user.click(searchButton)

      expect(onSearch).toHaveBeenCalledWith('test query')
    })

    it('should call onSearch when form submitted via Enter key', async () => {
      const onSearch = vi.fn()
      const user = userEvent.setup()

      render(<SearchBar onSearch={onSearch} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test query{Enter}')

      expect(onSearch).toHaveBeenCalledWith('test query')
    })

    it('should navigate with search param when onSearch not provided', async () => {
      const user = userEvent.setup()
      render(<SearchBar />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test query')

      const searchButton = screen.getByRole('button', { name: 'Search' })
      await user.click(searchButton)

      expect(mockPush).toHaveBeenCalledWith('/admin/posts?search=test query')
    })

    it('should call onClear when clear button clicked', async () => {
      const onClear = vi.fn()
      const user = userEvent.setup()

      render(<SearchBar onClear={onClear} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      const clearButton = screen.getByText('✕')
      await user.click(clearButton)

      expect(onClear).toHaveBeenCalled()
    })

    it('should not call onClear when not provided', async () => {
      const user = userEvent.setup()
      render(<SearchBar />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      const clearButton = screen.getByText('✕')
      await user.click(clearButton)

      // Should not throw error
      expect(input).toHaveValue('')
    })

    it('should trim whitespace from search query', async () => {
      const onSearch = vi.fn()
      const user = userEvent.setup()

      render(<SearchBar onSearch={onSearch} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, '   spaces   ')

      const searchButton = screen.getByRole('button', { name: 'Search' })
      await user.click(searchButton)

      expect(onSearch).toHaveBeenCalledWith('spaces')
    })

    it('should allow searching for empty string', async () => {
      const onSearch = vi.fn()
      const user = userEvent.setup()

      render(<SearchBar onSearch={onSearch} />)

      const searchButton = screen.getByRole('button', { name: 'Search' })
      await user.click(searchButton)

      expect(onSearch).toHaveBeenCalledWith('')
    })
  })

  describe('form behavior', () => {
    it('should prevent default form submission', async () => {
      const onSearch = vi.fn()
      const user = userEvent.setup()

      render(<SearchBar onSearch={onSearch} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test{Enter}')

      // Form should not reload the page
      expect(onSearch).toHaveBeenCalled()
    })

    it('should submit via button click', async () => {
      const onSearch = vi.fn()
      const user = userEvent.setup()

      render(<SearchBar onSearch={onSearch} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test')

      const searchButton = screen.getByRole('button', { name: 'Search' })
      await user.click(searchButton)

      expect(onSearch).toHaveBeenCalledWith('test')
    })

    it('should submit via Enter key', async () => {
      const onSearch = vi.fn()
      const user = userEvent.setup()

      render(<SearchBar onSearch={onSearch} />)

      const input = screen.getByPlaceholderText('Search...')
      await user.type(input, 'test{Enter}')

      expect(onSearch).toHaveBeenCalledWith('test')
    })
  })
})
