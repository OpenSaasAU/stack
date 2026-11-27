import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DeleteButton,
  ItemCreateForm,
  ItemEditForm,
  ListTable,
  SearchBar,
} from '../../src/components/standalone/index.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

const push = vi.fn()
let currentSearch = ''
vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/posts',
  useSearchParams: () => new URLSearchParams(currentSearch),
}))

type Result = { success: boolean; error?: string }

const fields: Record<string, SerializableFieldConfig> = {
  title: { type: 'text' },
  views: { type: 'integer' },
}

const UNREACHABLE_SAVE =
  "Couldn't reach the server. Your changes may or may not have been saved, so reload to check before trying again."

beforeEach(() => {
  push.mockClear()
  currentSearch = ''
})

describe('ItemCreateForm', () => {
  it('clears the form and says so after a successful create', async () => {
    const onSubmit = vi.fn(async (): Promise<Result> => ({ success: true }))
    render(<ItemCreateForm fields={fields} onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'New post')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Created.')
    expect(screen.getByLabelText('Title')).toHaveValue('')
    expect(onSubmit).toHaveBeenCalledWith({ title: 'New post' })
  })

  it('keeps the values when the create is refused', async () => {
    render(
      <ItemCreateForm
        fields={fields}
        onSubmit={async () => ({ success: false, error: 'Access denied' })}
      />,
    )

    await userEvent.type(screen.getByLabelText('Title'), 'New post')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied')
    expect(screen.getByLabelText('Title')).toHaveValue('New post')
  })

  it('says the outcome is unknown when the server cannot be reached', async () => {
    render(
      <ItemCreateForm
        fields={fields}
        onSubmit={async () => Promise.reject(new TypeError('Failed to fetch'))}
      />,
    )

    await userEvent.type(screen.getByLabelText('Title'), 'New post')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(UNREACHABLE_SAVE)
    expect(screen.getByLabelText('Title')).toHaveValue('New post')
  })
})

describe('ItemEditForm', () => {
  const initialData = { title: 'Hello', views: 3 }

  it('says there is nothing to save, and never calls onCancel', async () => {
    const onCancel = vi.fn()
    const onUnchanged = vi.fn()
    const onSubmit = vi.fn(async (): Promise<Result> => ({ success: true }))
    render(
      <ItemEditForm
        fields={fields}
        initialData={initialData}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onUnchanged={onUnchanged}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent('No changes to save.')
    expect(onUnchanged).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('says Saved. after a successful save, until the next edit', async () => {
    render(
      <ItemEditForm
        fields={fields}
        initialData={initialData}
        onSubmit={async () => ({ success: true })}
      />,
    )

    await userEvent.type(screen.getByLabelText('Title'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')

    await userEvent.type(screen.getByLabelText('Title'), '?')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says the outcome is unknown when the server cannot be reached', async () => {
    render(
      <ItemEditForm
        fields={fields}
        initialData={initialData}
        onSubmit={async () => Promise.reject(new TypeError('Failed to fetch'))}
      />,
    )

    await userEvent.type(screen.getByLabelText('Title'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(UNREACHABLE_SAVE)
  })
})

describe('DeleteButton', () => {
  async function confirmDelete() {
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    )
  }

  it('announces a refusal', async () => {
    render(<DeleteButton onDelete={async () => ({ success: false, error: 'Access denied' })} />)

    await confirmDelete()

    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied')
  })

  it('says the outcome is unknown when the server cannot be reached', async () => {
    render(
      <DeleteButton
        itemName="post"
        onDelete={async () => Promise.reject(new TypeError('Failed to fetch'))}
      />,
    )

    await confirmDelete()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't reach the server. The post may or may not have been deleted, so reload to check before trying again.",
    )
  })
})

describe('ListTable', () => {
  const items = [
    { id: '1', title: 'A', views: 120, at: '2026-03-01T00:00:00Z' },
    { id: '2', title: 'B', views: 9, at: null },
    { id: '3', title: 'C', views: null, at: '2025-12-31T00:00:00Z' },
    { id: '4', title: 'D', views: 10, at: '2026-01-15T00:00:00Z' },
  ]
  const fieldTypes = { title: 'text', views: 'integer', at: 'timestamp' }

  function column(index: number) {
    return screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[index].textContent)
  }

  it('sorts numbers by value with empty values last, either way', async () => {
    render(<ListTable items={items} fieldTypes={fieldTypes} columns={['title', 'views']} />)

    await userEvent.click(screen.getByRole('button', { name: /Views/ }))
    expect(column(0)).toEqual(['B', 'D', 'A', 'C'])

    await userEvent.click(screen.getByRole('button', { name: /Views/ }))
    expect(column(0)).toEqual(['A', 'D', 'B', 'C'])
  })

  it('sorts timestamps by time', async () => {
    render(<ListTable items={items} fieldTypes={fieldTypes} columns={['title', 'at']} />)

    await userEvent.click(screen.getByRole('button', { name: /At/ }))

    expect(column(0)).toEqual(['C', 'D', 'A', 'B'])
  })

  it('lets a clickable row be reached and opened from the keyboard', async () => {
    const onRowClick = vi.fn()
    render(
      <ListTable
        items={items}
        fieldTypes={fieldTypes}
        columns={['title']}
        sortable={false}
        onRowClick={onRowClick}
      />,
    )

    await userEvent.tab()
    expect(screen.getAllByRole('row')[1]).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(onRowClick).toHaveBeenCalledWith(items[0])
  })

  it('leaves rows out of the tab order when they do nothing', () => {
    render(<ListTable items={items} fieldTypes={fieldTypes} columns={['title']} />)

    expect(screen.getAllByRole('row')[1]).not.toHaveAttribute('tabindex')
  })
})

describe('SearchBar', () => {
  it('searches for nothing when cleared', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)

    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'road{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(onSearch).toHaveBeenLastCalledWith('')
  })

  it('keeps the other parameters, starts at page 1, and drops an empty search', async () => {
    currentSearch = 'status=draft&page=3&search=old'
    render(<SearchBar defaultValue="old" />)

    const box = screen.getByRole('textbox', { name: 'Search' })
    await userEvent.clear(box)
    await userEvent.type(box, 'road map{Enter}')
    expect(push).toHaveBeenLastCalledWith('/posts?status=draft&search=road+map')

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(push).toHaveBeenLastCalledWith('/posts?status=draft')
  })
})

describe('the standalone forms’ buttons and payload', () => {
  it('shows Cancel only with onCancel', () => {
    const { unmount } = render(
      <ItemCreateForm fields={fields} onSubmit={async () => ({ success: true })} />,
    )
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    unmount()

    render(
      <ItemCreateForm
        fields={fields}
        onSubmit={async () => ({ success: true })}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('reads Creating… while sending', async () => {
    render(<ItemCreateForm fields={fields} onSubmit={() => new Promise<Result>(() => {})} />)

    await userEvent.type(screen.getByLabelText('Title'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('button', { name: /Creating…/ })).toBeDisabled()
  })

  it('sends only the fields that changed', async () => {
    const onSubmit = vi.fn(async (): Promise<Result> => ({ success: true }))
    render(
      <ItemEditForm
        fields={fields}
        initialData={{ title: 'Hello', views: 3 }}
        onSubmit={onSubmit}
      />,
    )

    await userEvent.type(screen.getByLabelText('Title'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(onSubmit).toHaveBeenCalledWith({ title: 'Hello!' })
  })
})
