import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipTableClient } from '../../src/components/RelationshipTableClient.js'
import type { RelationshipTableClientProps } from '../../src/components/RelationshipTableClient.js'

// Mock Next.js navigation (client component uses useRouter for row navigation).
const mockPush = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush }),
}))

function baseProps(): RelationshipTableClientProps {
  return {
    title: 'Posts',
    relatedUrlKey: 'post',
    basePath: '/admin',
    columns: ['title', 'viewCount'],
    fields: { title: { type: 'text' }, viewCount: { type: 'integer' } },
    rows: [
      { id: 'p1', title: 'First', viewCount: 5 },
      { id: 'p2', title: 'Second', viewCount: 10 },
    ],
    count: 2,
    sumColumns: ['viewCount'],
    sums: { viewCount: 15 },
  }
}

describe('RelationshipTableClient', () => {
  beforeEach(() => {
    mockPush.mockClear()
  })

  it('renders the section heading, columns, and rows', () => {
    render(<RelationshipTableClient {...baseProps()} />)

    expect(screen.getByRole('heading', { name: 'Posts' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'View Count' })).toBeInTheDocument()
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('always shows the row count and sums configured numeric columns via the Cell', () => {
    render(<RelationshipTableClient {...baseProps()} />)

    const footer = document.querySelector('[data-slot="relationship-table-footer"]')
    expect(footer).not.toBeNull()
    // Count always shown; summed column rendered through its Cell (5 + 10 = 15).
    expect(footer).toHaveTextContent('2 rows')
    expect(footer).toHaveTextContent('15')
  })

  it('navigates to the related record when a row is clicked', async () => {
    render(<RelationshipTableClient {...baseProps()} />)
    const user = userEvent.setup()

    await user.click(screen.getByText('First'))
    expect(mockPush).toHaveBeenCalledWith('/admin/post/p1')
  })

  it('renders an empty state and a zero-count footer with no rows', () => {
    render(<RelationshipTableClient {...baseProps()} rows={[]} count={0} />)

    expect(screen.getByText(/no related posts/i)).toBeInTheDocument()
    const footer = document.querySelector('[data-slot="relationship-table-footer"]')
    expect(footer).toHaveTextContent('0 rows')
  })

  it('still shows the row count when there are zero columns (only the back-reference curated away)', () => {
    render(
      <RelationshipTableClient
        {...baseProps()}
        columns={[]}
        fields={{}}
        sumColumns={[]}
        sums={{}}
        count={3}
      />,
    )

    const footer = document.querySelector('[data-slot="relationship-table-footer"]')
    expect(footer).not.toBeNull()
    // The always-shown count must survive the zero-column footer.
    expect(within(footer as HTMLElement).getByText('3 rows')).toBeInTheDocument()
  })
})
