import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComboboxField } from '../../src/components/fields/ComboboxField.js'

const initialItems = [
  { id: 'u1', label: 'Ada Lovelace' },
  { id: 'u2', label: 'Alan Turing' },
]

describe('ComboboxField', () => {
  describe('without a server action (client-side filter fallback)', () => {
    it('renders the initial window and filters it locally while typing', async () => {
      const user = userEvent.setup()
      render(
        <ComboboxField
          name="author"
          value={null}
          onChange={vi.fn()}
          label="Author"
          items={initialItems}
        />,
      )

      await user.click(screen.getByRole('button'))
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
      expect(screen.getByText('Alan Turing')).toBeInTheDocument()

      await user.type(screen.getByPlaceholderText('Search...'), 'Ada')
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
      expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument()
    })
  })

  describe('with a server action (debounced live search)', () => {
    it('shows the currently-selected value label on initial render without searching', () => {
      const serverAction = vi.fn()
      render(
        <ComboboxField
          name="author"
          value="u1"
          onChange={vi.fn()}
          label="Author"
          items={initialItems}
          listKey="Post"
          serverAction={serverAction}
        />,
      )

      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
      expect(serverAction).not.toHaveBeenCalled()
    })

    it('debounces typed input and calls the relationshipOptions op with listKey/field/search', async () => {
      const user = userEvent.setup()
      const serverAction = vi.fn().mockResolvedValue({
        success: true,
        data: [{ id: 'u3', label: 'Grace Hopper' }],
      })

      render(
        <ComboboxField
          name="author"
          value={null}
          onChange={vi.fn()}
          label="Author"
          items={initialItems}
          listKey="Post"
          serverAction={serverAction}
          debounceMs={10}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.type(screen.getByPlaceholderText('Search...'), 'Grace')

      await waitFor(() => {
        expect(serverAction).toHaveBeenCalledWith({
          listKey: 'Post',
          action: 'relationshipOptions',
          field: 'author',
          search: 'Grace',
          selectedIds: [],
        })
      })

      await waitFor(() => {
        expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
      })
      // The un-matching initial-window item is no longer shown — the list
      // reflects the server's search result, not a client-side filter.
      expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    })

    it('persists the selection found via live search on change', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const serverAction = vi.fn().mockResolvedValue({
        success: true,
        data: [{ id: 'u3', label: 'Grace Hopper' }],
      })

      render(
        <ComboboxField
          name="author"
          value={null}
          onChange={onChange}
          label="Author"
          items={initialItems}
          listKey="Post"
          serverAction={serverAction}
          debounceMs={10}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.type(screen.getByPlaceholderText('Search...'), 'Grace')
      await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeInTheDocument())

      await user.click(screen.getByText('Grace Hopper'))
      expect(onChange).toHaveBeenCalledWith('u3')
    })

    it('recovers from a rejected search instead of getting stuck on "Searching..."', async () => {
      const user = userEvent.setup()
      const serverAction = vi.fn().mockRejectedValue(new Error('network error'))

      render(
        <ComboboxField
          name="author"
          value={null}
          onChange={vi.fn()}
          label="Author"
          items={initialItems}
          listKey="Post"
          serverAction={serverAction}
          debounceMs={10}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.type(screen.getByPlaceholderText('Search...'), 'Grace')

      await waitFor(() => expect(serverAction).toHaveBeenCalled())
      await waitFor(() => {
        expect(screen.queryByText('Searching...')).not.toBeInTheDocument()
      })
      expect(screen.getByText('No results found.')).toBeInTheDocument()
    })
  })
})
