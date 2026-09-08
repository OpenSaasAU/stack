import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
      mode: 'junction',
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
    serverAction.mockReset()
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

  it('sends one create while one is in flight, however many times it is clicked', async () => {
    // The popover stays open until the create succeeds, so a second click
    // lands on a live item. A junction with no unique pair index would store
    // the edge twice.
    let settle: (value: { added: boolean; id: string }) => void = () => {}
    serverAction.mockImplementation(
      () =>
        new Promise<{ added: boolean; id: string }>((resolve) => {
          settle = resolve
        }),
    )
    const user = userEvent.setup()
    render(<RelationshipTableClient {...junctionProps()} />)

    await user.click(screen.getByRole('button', { name: /Link Tag/i }))
    const [alpha, beta] = document.querySelectorAll('[data-slot="combobox-item"]')
    await user.click(beta)
    await user.click(beta)
    // A different endpoint too — the guard is on the flight, not on the id.
    await user.click(alpha)

    expect(serverAction).toHaveBeenCalledTimes(1)

    settle({ added: true, id: 'e1' })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it('renders no link control for a section whose edges cannot be written', () => {
    const props = junctionProps()
    render(<RelationshipTableClient {...props} linkEdge={undefined} />)

    expect(screen.queryByRole('button', { name: /Link Tag/i })).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="relationship-table-link"]')).toBeNull()
  })
})

describe('the to-many section can link an existing row by its own foreign key', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockRefresh.mockClear()
    serverAction.mockReset()
    serverAction.mockResolvedValue({ linked: true })
  })

  function foreignKeyProps(): RelationshipTableClientProps {
    return {
      ...junctionProps(),
      title: 'Posts',
      relatedUrlKey: 'post',
      columns: ['title'],
      fields: { title: { type: 'text' } },
      rows: [{ id: 'p1', title: 'Owned' }],
      relatedListKey: 'Post',
      backReferenceField: 'author',
      parentId: 'u1',
      parentListKey: 'User',
      fieldName: 'posts',
      linkEdge: {
        mode: 'foreignKey',
        relatedListKey: 'Post',
        backReferenceField: 'author',
        targetListKey: 'Post',
        options: [
          { id: 'p1', label: 'Owned' },
          { id: 'p2', label: 'Loose' },
        ],
      },
    }
  }

  it('targets the RELATED list, naming the back-reference and the parent id', async () => {
    const user = userEvent.setup()
    render(<RelationshipTableClient {...foreignKeyProps()} />)

    await user.click(screen.getByRole('button', { name: /Link Post/i }))
    await user.click(screen.getByText('Loose'))

    expect(serverAction).toHaveBeenCalledTimes(1)
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'linkRelated',
      id: 'p2',
      field: 'author',
      parentId: 'u1',
    })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it('leaves the row unlinked and shows the reason when the write is denied', async () => {
    serverAction.mockResolvedValue({ linked: false, error: 'Access denied or operation failed' })
    const user = userEvent.setup()
    render(<RelationshipTableClient {...foreignKeyProps()} />)

    await user.click(screen.getByRole('button', { name: /Link Post/i }))
    await user.click(screen.getByText('Loose'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied or operation failed')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
