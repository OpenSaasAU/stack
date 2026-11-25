import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { text } from '@opensaas/stack-core/fields'
import { ItemFormClient, type ItemFormClientProps } from '../../src/components/ItemFormClient.js'
import { projectFieldConfigs } from '../../src/lib/serializeFieldConfig.js'
import type { ServerActionInput } from '../../src/server/types.js'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push, refresh }),
}))

const fields = projectFieldConfigs({ title: text() })

type Action = (input: ServerActionInput) => Promise<unknown>

function renderForm(props: Partial<ItemFormClientProps> & { serverAction: Action }) {
  return render(
    <ItemFormClient
      listKey="Post"
      urlKey="post"
      mode="edit"
      fields={fields}
      initialData={{ title: 'Hello' }}
      itemId="p1"
      basePath="/admin"
      {...props}
    />,
  )
}

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
  window.sessionStorage.clear()
})

describe('ItemFormClient', () => {
  describe('create', () => {
    it('sends a create action and returns to the list', async () => {
      const serverAction = vi.fn<Action>(async () => ({ success: true, data: { id: 'p2' } }))
      renderForm({ mode: 'create', initialData: {}, itemId: undefined, serverAction })

      await userEvent.type(screen.getByLabelText('Title'), 'New post')
      await userEvent.click(screen.getByRole('button', { name: 'Create' }))

      await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/post'))
      expect(serverAction).toHaveBeenCalledWith({
        listKey: 'Post',
        action: 'create',
        data: { title: 'New post' },
      })
      expect(refresh).toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    })

    it('treats a truthy legacy result as success', async () => {
      const serverAction = vi.fn<Action>(async () => ({ id: 'p2' }))
      renderForm({ mode: 'create', initialData: {}, itemId: undefined, serverAction })

      await userEvent.type(screen.getByLabelText('Title'), 'x')
      await userEvent.click(screen.getByRole('button', { name: 'Create' }))

      await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/post'))
    })

    it('reports a null legacy result as denied and stays put', async () => {
      const serverAction = vi.fn<Action>(async () => null)
      renderForm({ mode: 'create', initialData: {}, itemId: undefined, serverAction })

      await userEvent.type(screen.getByLabelText('Title'), 'x')
      await userEvent.click(screen.getByRole('button', { name: 'Create' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Access denied or operation failed',
      )
      expect(push).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('sends an update action for the item', async () => {
      const serverAction = vi.fn<Action>(async () => ({ success: true, data: {} }))
      renderForm({ serverAction })

      const input = screen.getByLabelText('Title')
      await userEvent.clear(input)
      await userEvent.type(input, 'Changed')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/post'))
      expect(serverAction).toHaveBeenCalledWith({
        listKey: 'Post',
        action: 'update',
        id: 'p1',
        data: { title: 'Changed' },
      })
    })

    it('shows the envelope error and its field error', async () => {
      const serverAction = vi.fn<Action>(async () => ({
        success: false,
        error: 'Could not save',
        fieldErrors: { title: 'Title is taken' },
      }))
      renderForm({ serverAction })

      await userEvent.type(screen.getByLabelText('Title'), '!')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
      expect(screen.getByText('Title is taken')).toBeInTheDocument()
      expect(push).not.toHaveBeenCalled()
    })

    it('returns to the list on Cancel without calling the server', async () => {
      const serverAction = vi.fn<Action>()
      renderForm({ serverAction })

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(push).toHaveBeenCalledWith('/admin/post')
      expect(serverAction).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('asks before deleting and does nothing on Cancel', async () => {
      const serverAction = vi.fn<Action>()
      renderForm({ serverAction })

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument()

      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(serverAction).not.toHaveBeenCalled()
    })

    it('deletes on confirm and returns to the list', async () => {
      const serverAction = vi.fn<Action>(async () => ({ success: true, data: {} }))
      renderForm({ serverAction })

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/post'))
      expect(serverAction).toHaveBeenCalledWith({ listKey: 'Post', action: 'delete', id: 'p1' })
      expect(refresh).toHaveBeenCalled()
    })

    it('shows the failure and stays on the item when delete is denied', async () => {
      const serverAction = vi.fn<Action>(async () => null)
      renderForm({ serverAction })

      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Access denied or failed to delete item',
      )
      expect(push).not.toHaveBeenCalled()
    })

    it('offers no Delete when canDelete is false', () => {
      renderForm({ serverAction: vi.fn<Action>(), canDelete: false })

      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })
  })

  describe('read-only field mode', () => {
    it('renders values read-only with no Save or Cancel', () => {
      renderForm({ serverAction: vi.fn<Action>(), fieldMode: 'read' })

      expect(screen.getByText('Hello')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    })

    it('never submits', () => {
      const serverAction = vi.fn<Action>()
      const { container } = renderForm({ serverAction, fieldMode: 'read' })

      container.querySelector('form')!.requestSubmit()

      expect(serverAction).not.toHaveBeenCalled()
      expect(push).not.toHaveBeenCalled()
    })

    it('does not apply to create', () => {
      renderForm({
        serverAction: vi.fn<Action>(),
        mode: 'create',
        itemId: undefined,
        initialData: {},
        fieldMode: 'read',
      })

      expect(screen.getByLabelText('Title')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })
  })
})
