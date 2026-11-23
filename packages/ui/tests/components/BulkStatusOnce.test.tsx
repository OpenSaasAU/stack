import * as React from 'react'
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

  it('does not replay a status that survived without a remount', async () => {
    const { unmount } = render(<Setter />)
    act(() => screen.getByText('set').click())
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 5))
    render(<ListViewClient {...props} />)
    expect(screen.queryByText('Post published')).toBeNull()
  })

  it('does not replay an entry from a previous page load', () => {
    window.sessionStorage.setItem(
      'opensaas:bulk-status:Post',
      JSON.stringify({ text: 'Link copied', at: Date.now() }),
    )
    render(<ListViewClient {...props} />)
    expect(screen.queryByText('Link copied')).toBeNull()
  })

  it('clears the status when the list params change', () => {
    function Probe({ resetKey }: { resetKey: string }) {
      const { status, setStatus } = useBulkStatus('Post', resetKey)
      return (
        <>
          <button onClick={() => setStatus('Post published')}>set</button>
          <span data-testid="s">{status}</span>
        </>
      )
    }
    const view = render(<Probe resetKey="a" />)
    act(() => screen.getByText('set').click())
    expect(screen.getByTestId('s')).toHaveTextContent('Post published')
    view.rerender(<Probe resetKey="b" />)
    expect(screen.getByTestId('s')).toBeEmptyDOMElement()
  })

  it('keeps a handed-off status under StrictMode effect replay', () => {
    function Probe() {
      const { status, setStatus } = useBulkStatus('Post')
      return (
        <>
          <button onClick={() => setStatus('Post published', { handoff: true })}>set</button>
          <span data-testid="s">{status}</span>
        </>
      )
    }
    const first = render(<Probe />)
    act(() => screen.getByText('set').click())
    first.unmount()
    render(
      <React.StrictMode>
        <Probe />
      </React.StrictMode>,
    )
    expect(screen.getByTestId('s')).toHaveTextContent('Post published')
  })

  it('keeps the status through one exempted reset, then clears on the next', () => {
    function Probe({ resetKey }: { resetKey: string }) {
      const { status, setStatus, keepThroughNextReset } = useBulkStatus('Post', resetKey)
      return (
        <>
          <button onClick={() => setStatus('Post published')}>set</button>
          <button onClick={keepThroughNextReset}>keep</button>
          <span data-testid="s">{status}</span>
        </>
      )
    }
    const view = render(<Probe resetKey="p2" />)
    act(() => screen.getByText('set').click())
    act(() => screen.getByText('keep').click())
    view.rerender(<Probe resetKey="p1" />)
    expect(screen.getByTestId('s')).toHaveTextContent('Post published')
    view.rerender(<Probe resetKey="p1-sorted" />)
    expect(screen.getByTestId('s')).toBeEmptyDOMElement()
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
