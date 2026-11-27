import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { text } from '@opensaas/stack-core/fields'
import { ItemFormClient, type ItemFormClientProps } from '../../src/components/ItemFormClient.js'
import { SAVE_NOTICE_KEY } from '../../src/components/SaveNotice.js'
import { projectFieldConfigs } from '../../src/lib/serializeFieldConfig.js'
import type { ServerActionInput } from '../../src/server/types.js'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/admin/post/p1',
}))

type Action = (input: ServerActionInput) => Promise<unknown>

const fields = projectFieldConfigs({ title: text() })
const LIST_STATUS = 'opensaas:bulk-status:Post'

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
      itemLabel="Hello"
      {...props}
    />,
  )
}

async function changeTitle(to: string) {
  const input = screen.getByLabelText('Title')
  await userEvent.clear(input)
  await userEvent.type(input, to)
}

const listStatus = () => JSON.parse(window.sessionStorage.getItem(LIST_STATUS) ?? 'null')?.text

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
  window.sessionStorage.clear()
})

describe('saving an existing item', () => {
  it('stays on the item after Save and says it saved', async () => {
    const serverAction = vi.fn<Action>(async () => ({ success: true, data: {} }))
    renderForm({ serverAction })

    await changeTitle('Changed')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'update',
      id: 'p1',
      data: { title: 'Changed' },
    })
    expect(push).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(SAVE_NOTICE_KEY)).toBe('Saved.')
  })

  it('is clean again after Save, so leaving does not ask', async () => {
    const serverAction = vi.fn<Action>(async () => ({ success: true, data: {} }))
    renderForm({ serverAction })

    await changeTitle('Changed')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(push).toHaveBeenCalledWith('/admin/post')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('returns to the list after Save and close', async () => {
    const serverAction = vi.fn<Action>(async () => ({ success: true, data: {} }))
    renderForm({ serverAction })

    await changeTitle('Changed')
    await userEvent.click(screen.getByRole('button', { name: 'Save and close' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/post'))
    expect(listStatus()).toBe('Changes saved')
  })

  it('says there was nothing to save when nothing changed', async () => {
    const serverAction = vi.fn<Action>()
    renderForm({ serverAction })

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(window.sessionStorage.getItem(SAVE_NOTICE_KEY)).toBe('No changes to save.'),
    )
    expect(serverAction).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('saves and stays when Enter submits the form', async () => {
    const serverAction = vi.fn<Action>(async () => ({ success: true, data: {} }))
    renderForm({ serverAction })

    await changeTitle('Changed{Enter}')

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })

  it('offers only Save on a singleton, which stays put as before', () => {
    renderForm({ serverAction: vi.fn<Action>(), singleton: true, canDelete: false })

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save and close' })).not.toBeInTheDocument()
  })
})

describe('creating an item', () => {
  it('says Creating while it waits, and returns to the list', async () => {
    let resolve: (value: unknown) => void = () => undefined
    const serverAction = vi.fn<Action>(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    renderForm({
      serverAction,
      mode: 'create',
      itemId: undefined,
      initialData: {},
      itemLabel: undefined,
    })

    await userEvent.type(screen.getByLabelText('Title'), 'New')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('button', { name: /Creating/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save and close' })).not.toBeInTheDocument()
    resolve({ success: true, data: { id: 'p2' } })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/post'))
    expect(listStatus()).toBe('Item created')
  })
})

describe('deleting an item', () => {
  it('names the item it is about to delete', async () => {
    renderForm({ serverAction: vi.fn<Action>() })

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete this Post?')).toBeInTheDocument()
    expect(
      within(dialog).getByText('“Hello” will be permanently deleted. This cannot be undone.'),
    ).toBeInTheDocument()
  })

  it('confirms on the list that it was deleted', async () => {
    const serverAction = vi.fn<Action>(async () => ({ success: true, data: {} }))
    renderForm({ serverAction })

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/post'))
    expect(listStatus()).toBe('Item deleted')
  })
})

describe('when the server cannot be reached', () => {
  it('says a save may or may not have happened, instead of the raw error', async () => {
    const serverAction = vi.fn<Action>(async () => {
      throw new TypeError('Failed to fetch')
    })
    renderForm({ serverAction })

    await changeTitle('Changed')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      "Couldn't reach the server. Your changes may or may not have been saved, so reload to check before trying again.",
    )
    expect(alert).not.toHaveTextContent('Failed to fetch')
  })

  it('says a delete may or may not have happened', async () => {
    const serverAction = vi.fn<Action>(async () => {
      throw new TypeError('Failed to fetch')
    })
    renderForm({ serverAction })

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't reach the server. The item may or may not have been deleted, so reload to check before trying again.",
    )
    expect(push).not.toHaveBeenCalled()
  })
})
