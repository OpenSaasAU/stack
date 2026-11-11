import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { ListViewClient } from '../../src/components/ListViewClient.js'
import { useBulkStatus, clearAllBulkStatuses } from '../../src/lib/useBulkStatus.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/post',
}))

const props = {
  items: [{ id: '1', title: 'First' }],
  fieldTypes: { title: 'text' },
  relationshipRefs: {},
  listKey: 'Post',
  urlKey: 'post',
  basePath: '/admin',
  page: 1,
  pageSize: 10,
  total: 1,
}

function Setter({ handoff = true }: { handoff?: boolean }) {
  const { setStatus } = useBulkStatus('Post')
  return <button onClick={() => setStatus('Post published', { handoff })}>set</button>
}

beforeEach(() => window.sessionStorage.clear())
afterEach(() => cleanup())

describe('list status line', () => {
  it('shows once on the next mount and is gone on the second', () => {
    const { unmount } = render(<Setter />)
    act(() => screen.getByText('set').click())
    unmount()

    const first = render(<ListViewClient {...props} />)
    expect(screen.getByRole('status')).toHaveTextContent('Post published')
    first.unmount()

    render(<ListViewClient {...props} />)
    expect(screen.queryByText('Post published')).toBeNull()
  })

  it('does not carry a status to a later mount when no refresh follows it', () => {
    const { unmount } = render(<Setter handoff={false} />)
    act(() => screen.getByText('set').click())
    unmount()

    render(<ListViewClient {...props} />)
    expect(screen.queryByText('Post published')).toBeNull()
  })

  it('drops a status older than the hand-off window', () => {
    window.sessionStorage.setItem(
      'opensaas:bulk-status:Post',
      JSON.stringify({ text: 'Link copied', at: Date.now() - 60_000 }),
    )
    render(<ListViewClient {...props} />)
    expect(screen.queryByText('Link copied')).toBeNull()
  })

  it('clearAllBulkStatuses removes pending statuses', () => {
    window.sessionStorage.setItem(
      'opensaas:bulk-status:Post',
      JSON.stringify({ text: 'x', at: Date.now() }),
    )
    clearAllBulkStatuses()
    render(<ListViewClient {...props} />)
    expect(screen.queryByText('x')).toBeNull()
  })
})
