import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipTableClient } from '../../src/components/RelationshipTableClient.js'
import type { RelationshipTableClientProps } from '../../src/components/RelationshipTableClient.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

const serverAction = vi.fn(async () => ({ added: true, id: 'e1' }))

function junctionProps(): RelationshipTableClientProps {
  return {
    title: 'Tags',
    relatedUrlKey: 'post-tag',
    basePath: '/admin',
    columns: ['tag'],
    fields: { tag: { type: 'relationship' } },
    rows: [{ id: 'pt1', tag: { id: 't1', label: 'alpha' } }],
    count: 1,
    sumColumns: [],
    sums: {},
    removeMode: null,
    relatedListKey: 'PostTag',
    backReferenceField: 'post',
    parentId: 'p1',
    parentListKey: 'Post',
    fieldName: 'tags',
    linkEdge: {
      junctionListKey: 'PostTag',
      targetField: 'tag',
      targetListKey: 'Tag',
      options: [
        { id: 't1', label: 'alpha' },
        { id: 't2', label: 'beta' },
      ],
    },
    serverAction,
  }
}

describe('the to-many section can add an edge across a junction', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockRefresh.mockClear()
    serverAction.mockClear()
    serverAction.mockResolvedValue({ added: true, id: 'e1' })
  })

  it('sends the parent list, its field and both ids — and nothing else', async () => {
    const user = userEvent.setup()
    render(<RelationshipTableClient {...junctionProps()} />)

    await user.click(screen.getByRole('button', { name: /Link Tag/i }))
    await user.click(screen.getByText('beta'))

    expect(serverAction).toHaveBeenCalledTimes(1)
    // The whole payload, not a subset: a junction list the client could name,
    // or a column of the edge row it could set, would show up here.
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'addRelated',
      field: 'tags',
      parentId: 'p1',
      targetId: 't2',
    })
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('shows the denial reason and does not refresh when the edge is refused', async () => {
    serverAction.mockResolvedValue({ added: false, error: 'Access denied or operation failed' })
    const user = userEvent.setup()
    render(<RelationshipTableClient {...junctionProps()} />)

    await user.click(screen.getByRole('button', { name: /Link Tag/i }))
    await user.click(screen.getByText('beta'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied or operation failed')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('treats an unrecognised outcome as a failure rather than a silent success', async () => {
    serverAction.mockResolvedValue({ created: true })
    const user = userEvent.setup()
    render(<RelationshipTableClient {...junctionProps()} />)

    await user.click(screen.getByRole('button', { name: /Link Tag/i }))
    await user.click(screen.getByText('beta'))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('renders no link control for a section that is not an edge across a junction', () => {
    const props = junctionProps()
    render(<RelationshipTableClient {...props} linkEdge={undefined} />)

    expect(screen.queryByRole('button', { name: /Link Tag/i })).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="relationship-table-link"]')).toBeNull()
  })
})
