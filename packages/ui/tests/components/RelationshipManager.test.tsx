import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RelationshipManager } from '../../src/components/fields/RelationshipManager.js'

const initialItems = [
  { id: 't1', label: 'engineering' },
  { id: 't2', label: 'design' },
]

describe('RelationshipManager', () => {
  it('renders the currently-connected value label from the seeded window without searching', () => {
    const serverAction = vi.fn()
    render(
      <RelationshipManager
        name="tags"
        value={['t1']}
        onChange={vi.fn()}
        label="Tags"
        items={initialItems}
        listKey="Post"
        serverAction={serverAction}
      />,
    )

    expect(screen.getByText('engineering')).toBeInTheDocument()
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('excludes already-connected items from the connect-existing candidates', async () => {
    const user = userEvent.setup()
    render(
      <RelationshipManager
        name="tags"
        value={['t1']}
        onChange={vi.fn()}
        label="Tags"
        items={initialItems}
      />,
    )

    await user.click(screen.getByText('Connect Existing'))
    expect(screen.getByText('design')).toBeInTheDocument()
    // "engineering" appears once, in the connected table — not in the candidate list.
    expect(screen.getAllByText('engineering')).toHaveLength(1)
  })

  it('debounces typed input and calls the relationshipOptions op with listKey/field/search/selectedIds', async () => {
    const user = userEvent.setup()
    const serverAction = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 't9', label: 'security' }],
    })

    render(
      <RelationshipManager
        name="tags"
        value={['t1']}
        onChange={vi.fn()}
        label="Tags"
        items={initialItems}
        listKey="Post"
        serverAction={serverAction}
        debounceMs={10}
      />,
    )

    await user.click(screen.getByText('Connect Existing'))
    await user.type(screen.getByPlaceholderText('Search...'), 'sec')

    await waitFor(() => {
      expect(serverAction).toHaveBeenCalledWith({
        listKey: 'Post',
        action: 'relationshipOptions',
        field: 'tags',
        search: 'sec',
        selectedIds: ['t1'],
      })
    })

    await waitFor(() => {
      expect(screen.getByText('security')).toBeInTheDocument()
    })
  })

  it('connecting an item found via live search persists it and keeps its label visible', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const serverAction = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 't9', label: 'security' }],
    })

    function Wrapper() {
      const [value, setValue] = useState(['t1'])
      return (
        <RelationshipManager
          name="tags"
          value={value}
          onChange={(next: string[]) => {
            setValue(next)
            onChange(next)
          }}
          label="Tags"
          items={initialItems}
          listKey="Post"
          serverAction={serverAction}
          debounceMs={10}
        />
      )
    }

    render(<Wrapper />)

    await user.click(screen.getByText('Connect Existing'))
    await user.type(screen.getByPlaceholderText('Search...'), 'sec')
    await waitFor(() => expect(screen.getByText('security')).toBeInTheDocument())

    await user.click(screen.getByText('security'))
    expect(onChange).toHaveBeenCalledWith(['t1', 't9'])

    // Still labelled after the connect-dropdown closes and the query resets.
    expect(screen.getByText('security')).toBeInTheDocument()
    expect(screen.getByText('engineering')).toBeInTheDocument()
  })
})
