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

type Option = { id: string; label: string }

/**
 * The control defers its far-endpoint fetch to first open (#1365) and loads
 * it through the same `relationshipOptions` op the live search uses, so the
 * fixture's mock must answer that op distinctly from whatever edge-write
 * outcome a given test is probing.
 */
function serverActionReturning(writeResult: unknown, options: Option[]) {
  return vi.fn(async (input: { action?: unknown }) => {
    if (input.action === 'relationshipOptions') {
      return { success: true, data: options }
    }
    return writeResult
  })
}

/** The edge-write calls a mock received, excluding the options-load probe. */
function writeCallsOf(serverAction: { mock: { calls: [{ action?: unknown }][] } }) {
  return serverAction.mock.calls.filter(([input]) => input.action !== 'relationshipOptions')
}

const TAG_OPTIONS: Option[] = [
  { id: 't1', label: 'alpha' },
  { id: 't2', label: 'beta' },
]

const POST_OPTIONS: Option[] = [
  { id: 'p1', label: 'Owned' },
  { id: 'p2', label: 'Loose' },
]

function junctionProps(
  serverAction: RelationshipTableClientProps['serverAction'],
): RelationshipTableClientProps {
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
    },
    serverAction,
  }
}

describe('the to-many section can add an edge across a junction', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockRefresh.mockClear()
  })

  it('sends the parent list, its field and both ids — and nothing else', async () => {
    const serverAction = serverActionReturning({ added: true, id: 'e1' }, TAG_OPTIONS)
    const user = userEvent.setup()
    render(<RelationshipTableClient {...junctionProps(serverAction)} />)

    await user.click(screen.getByRole('button', { name: /Link Tag/i }))
    await user.click(await screen.findByText('beta'))

    const writes = writeCallsOf(serverAction)
    expect(writes).toHaveLength(1)
    // The whole payload, not a subset: a junction list the client could name,
    // or a column of the edge row it could set, would show up here.
    expect(writes[0][0]).toEqual({
      listKey: 'Post',
      action: 'addRelated',
      field: 'tags',
      parentId: 'p1',
      targetId: 't2',
    })
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('shows the denial reason and does not refresh when the edge is refused', async () => {
    const serverAction = serverActionReturning(
      { added: false, error: 'Access denied or operation failed' },
      TAG_OPTIONS,
    )
    const user = userEvent.setup()
    render(<RelationshipTableClient {...junctionProps(serverAction)} />)

    await user.click(screen.getByRole('button', { name: /Link Tag/i }))
    await user.click(await screen.findByText('beta'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied or operation failed')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('treats an unrecognised outcome as a failure rather than a silent success', async () => {
    const serverAction = serverActionReturning({ created: true }, TAG_OPTIONS)
    const user = userEvent.setup()
    render(<RelationshipTableClient {...junctionProps(serverAction)} />)

    await user.click(screen.getByRole('button', { name: /Link Tag/i }))
    await user.click(await screen.findByText('beta'))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('sends one create while one is in flight, however many times it is clicked', async () => {
    // The popover stays open until the create succeeds, so a second click
    // lands on a live item. A junction with no unique pair index would store
    // the edge twice.
    let settle: (value: { added: boolean; id: string }) => void = () => {}
    const serverAction = vi.fn(async (input: { action?: unknown }) => {
      if (input.action === 'relationshipOptions') {
        return { success: true, data: TAG_OPTIONS }
      }
      return new Promise<{ added: boolean; id: string }>((resolve) => {
        settle = resolve
      })
    })
    const user = userEvent.setup()
    render(<RelationshipTableClient {...junctionProps(serverAction)} />)

    await user.click(screen.getByRole('button', { name: /Link Tag/i }))
    // The table's own row already shows "alpha" (the existing linked tag), so
    // scope to the popover's own items rather than `findByText`.
    await screen.findByText('beta')
    const [alpha, beta] = await waitFor(() => {
      const items = document.querySelectorAll('[data-slot="combobox-item"]')
      expect(items).toHaveLength(2)
      return [...items]
    })
    await user.click(beta)
    await user.click(beta)
    // A different endpoint too — the guard is on the flight, not on the id.
    await user.click(alpha)

    expect(writeCallsOf(serverAction)).toHaveLength(1)

    settle({ added: true, id: 'e1' })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it('renders no link control for a section whose edges cannot be written', () => {
    const serverAction = serverActionReturning({ added: true, id: 'e1' }, TAG_OPTIONS)
    render(<RelationshipTableClient {...junctionProps(serverAction)} linkEdge={undefined} />)

    expect(screen.queryByRole('button', { name: /Link Tag/i })).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot="relationship-table-link"]')).toBeNull()
  })

  it('does not read the far endpoint before the control is opened (#1365)', () => {
    const serverAction = serverActionReturning({ added: true, id: 'e1' }, TAG_OPTIONS)
    render(<RelationshipTableClient {...junctionProps(serverAction)} />)

    expect(serverAction).not.toHaveBeenCalled()
  })
})

describe('the to-many section can link an existing row by its own foreign key', () => {
  beforeEach(() => {
    mockPush.mockClear()
    mockRefresh.mockClear()
  })

  function foreignKeyProps(
    serverAction: RelationshipTableClientProps['serverAction'],
  ): RelationshipTableClientProps {
    return {
      ...junctionProps(serverAction),
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
      },
    }
  }

  it('targets the RELATED list, naming the back-reference and the parent id', async () => {
    const serverAction = serverActionReturning({ linked: true }, POST_OPTIONS)
    const user = userEvent.setup()
    render(<RelationshipTableClient {...foreignKeyProps(serverAction)} />)

    await user.click(screen.getByRole('button', { name: /Link Post/i }))
    await user.click(await screen.findByText('Loose'))

    const writes = writeCallsOf(serverAction)
    expect(writes).toHaveLength(1)
    expect(writes[0][0]).toEqual({
      listKey: 'Post',
      action: 'linkRelated',
      id: 'p2',
      field: 'author',
      parentId: 'u1',
    })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it('leaves the row unlinked and shows the reason when the write is denied', async () => {
    const serverAction = serverActionReturning(
      { linked: false, error: 'Access denied or operation failed' },
      POST_OPTIONS,
    )
    const user = userEvent.setup()
    render(<RelationshipTableClient {...foreignKeyProps(serverAction)} />)

    await user.click(screen.getByRole('button', { name: /Link Post/i }))
    await user.click(await screen.findByText('Loose'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied or operation failed')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
