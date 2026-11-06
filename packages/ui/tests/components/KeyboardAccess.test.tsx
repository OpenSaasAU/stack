import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminFrame } from '../../src/components/AdminFrame.js'
import { ConfirmDialog } from '../../src/components/ConfirmDialog.js'
import { FilterBuilder } from '../../src/components/FilterBuilder.js'
import { ItemFormClient, type ItemFormClientProps } from '../../src/components/ItemFormClient.js'
import { ListViewClient } from '../../src/components/ListViewClient.js'
import { RelationshipLinkControl } from '../../src/components/RelationshipLinkControl.js'
import { CalendarDayField } from '../../src/components/fields/CalendarDayField.js'
import { ComboboxField } from '../../src/components/fields/ComboboxField.js'
import { FieldRenderer } from '../../src/components/fields/FieldRenderer.js'
import { FileField } from '../../src/components/fields/FileField.js'
import { ImageField } from '../../src/components/fields/ImageField.js'
import { JsonField } from '../../src/components/fields/JsonField.js'
import { PasswordField } from '../../src/components/fields/PasswordField.js'
import { RelationshipManager } from '../../src/components/fields/RelationshipManager.js'
import { TimestampField } from '../../src/components/fields/TimestampField.js'
import { ListTable } from '../../src/components/standalone/ListTable.js'
import { SearchBar } from '../../src/components/standalone/SearchBar.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

const mockPush = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: () => '/admin',
}))

const people = [
  { id: 'u1', label: 'Ada Lovelace' },
  { id: 'u2', label: 'Alan Turing' },
  { id: 'u3', label: 'Grace Hopper' },
]

function activeOption(): string | null {
  const input = screen.getByRole('combobox')
  const id = input.getAttribute('aria-activedescendant')
  return id ? (document.getElementById(id)?.textContent ?? null) : null
}

function renderPicker(overrides: Partial<React.ComponentProps<typeof ComboboxField>> = {}) {
  const onChange = vi.fn()
  render(
    <ComboboxField
      name="author"
      value={null}
      onChange={onChange}
      label="Author"
      items={people}
      {...overrides}
    />,
  )
  return onChange
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole('button', { name: /^Author/ }).focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
}

describe('the relationship picker by keyboard', () => {
  it('is a combobox that controls a named listbox of options', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    const input = screen.getByRole('combobox', { name: 'Search Author' })
    const listbox = screen.getByRole('listbox', { name: 'Author' })
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('dialog', { name: 'Author' })).toBeInTheDocument()
  })

  it('chooses the option the arrow keys reached', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()
    await openPicker(user)

    expect(activeOption()).toBe('Ada Lovelace')
    await user.keyboard('{ArrowDown}')
    expect(activeOption()).toBe('Alan Turing')
    expect(screen.getByRole('option', { name: 'Alan Turing' })).toHaveAttribute('data-active')
    expect(screen.getByRole('combobox')).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('u2')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('ignores the held-down Enter that opened it', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()
    await openPicker(user)

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', repeat: true })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('wraps at the ends and jumps with Home and End', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.keyboard('{ArrowUp}')
    expect(activeOption()).toBe('Grace Hopper')
    await user.keyboard('{ArrowDown}')
    expect(activeOption()).toBe('Ada Lovelace')
    await user.keyboard('{End}')
    expect(activeOption()).toBe('Grace Hopper')
    await user.keyboard('{Home}')
    expect(activeOption()).toBe('Ada Lovelace')
  })

  it('leaves Home and End to the caret once there is text in the box', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.keyboard('a')
    const input = screen.getByRole('combobox')
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true)
    expect(activeOption()).toBe('Ada Lovelace')
  })

  it('does not land Home on Clear selection', async () => {
    const user = userEvent.setup()
    renderPicker({ value: 'u3' })
    await openPicker(user)

    await user.keyboard('{Home}')
    expect(activeOption()).toBe('Ada Lovelace')
  })

  it('opens from the trigger with an arrow key', async () => {
    const user = userEvent.setup()
    renderPicker()

    screen.getByRole('button', { name: /^Author/ }).focus()
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
  })

  it('closes on Tab and on Escape without choosing, and gives focus back', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()
    const trigger = screen.getByRole('button', { name: /^Author/ })

    await openPicker(user)
    await user.keyboard('{Tab}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    await openPicker(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('starts on the current value, not on Clear selection', async () => {
    const user = userEvent.setup()
    renderPicker({ value: 'u3' })
    await openPicker(user)

    expect(activeOption()).toBe('Grace Hopper')
    expect(screen.getByRole('option', { name: 'Grace Hopper' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('reaches Clear selection with the arrows and clears the value', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker({ value: 'u1' })
    await openPicker(user)

    await user.keyboard('{ArrowUp}')
    expect(activeOption()).toBe('Clear selection')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('moves to the first match when typing filters the active option away', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()
    await openPicker(user)

    await user.keyboard('{End}')
    await user.keyboard('Tur')
    expect(activeOption()).toBe('Alan Turing')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('u2')
  })

  it('moves to the first match when typing keeps the active option in the results', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.keyboard('{ArrowDown}')
    expect(activeOption()).toBe('Alan Turing')
    await user.keyboard('A')
    expect(activeOption()).toBe('Ada Lovelace')
  })

  it('has no active option when nothing matches, so Enter does nothing', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()
    await openPicker(user)

    await user.keyboard('zzz')
    expect(activeOption()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('No results found.')
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  describe('over a server search', () => {
    function deferredSearch() {
      const resolvers: Array<(value: unknown) => void> = []
      const serverAction = vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            resolvers.push(resolve)
          }),
      )
      return { serverAction, resolvers }
    }

    it('takes nothing on Enter until the results for this query are in', async () => {
      const user = userEvent.setup()
      const { serverAction, resolvers } = deferredSearch()
      const onChange = renderPicker({ listKey: 'Post', serverAction, debounceMs: 20 })
      await openPicker(user)

      await user.keyboard('Grace')
      expect(screen.getByRole('status')).toHaveTextContent('Searching...')
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()

      await waitFor(() => expect(serverAction).toHaveBeenCalled())
      await user.keyboard('{Enter}')
      expect(onChange).not.toHaveBeenCalled()

      resolvers[0]({ options: [{ id: 'u3', label: 'Grace Hopper' }] })
      await waitFor(() => expect(activeOption()).toBe('Grace Hopper'))
      await user.keyboard('{Enter}')
      expect(onChange).toHaveBeenCalledExactlyOnceWith('u3')
    })

    it('does not offer the previous answer while a longer query waits on its debounce', async () => {
      const user = userEvent.setup()
      const { serverAction, resolvers } = deferredSearch()
      renderPicker({ listKey: 'Post', serverAction, debounceMs: 20 })
      await openPicker(user)

      await user.keyboard('A')
      await waitFor(() => expect(serverAction).toHaveBeenCalledTimes(1))
      resolvers[0]({ options: people.slice(0, 2) })
      await waitFor(() => expect(activeOption()).toBe('Ada Lovelace'))

      await user.keyboard('l')
      expect(screen.queryByRole('option')).not.toBeInTheDocument()
      expect(activeOption()).toBeNull()
    })

    it('starts a search on the first result, though the server unions in the current value', async () => {
      const user = userEvent.setup()
      const serverAction = vi.fn(async () => ({
        options: [
          { id: 'u2', label: 'Alan Turing' },
          { id: 'u3', label: 'Grace Hopper' },
        ],
      }))
      renderPicker({ value: 'u3', listKey: 'Post', serverAction, debounceMs: 20 })
      await openPicker(user)

      await user.keyboard('Alan')
      await waitFor(() => expect(activeOption()).toBe('Alan Turing'))
    })
  })

  it('connects to a to-many field, and keeps focus on the page when a row is removed', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [value, setValue] = React.useState(['u1'])
      return (
        <RelationshipManager
          name="reviewers"
          value={value}
          onChange={setValue}
          label="Reviewers"
          items={people}
        />
      )
    }
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Reviewers Connect Existing' })
    trigger.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus())
    expect(activeOption()).toBe('Alan Turing')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('button', { name: 'Remove Grace Hopper' })).toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())

    screen.getByRole('button', { name: 'Remove Ada Lovelace' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('button', { name: 'Remove Ada Lovelace' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('skips a disabled option while a link is in flight', async () => {
    const user = userEvent.setup()
    let finish: (value: unknown) => void = () => {}
    const serverAction = vi.fn((input: { action: string }) =>
      input.action === 'relationshipOptions'
        ? Promise.resolve({ options: people })
        : new Promise<unknown>((resolve) => {
            finish = resolve
          }),
    )
    render(
      <RelationshipLinkControl
        parentListKey="Post"
        fieldName="tags"
        parentId="p1"
        edge={{ mode: 'junction', junctionListKey: 'PostTag', targetField: 'tag' }}
        targetListTitle="Tag"
        serverAction={serverAction}
      />,
    )

    screen.getByRole('button', { name: 'Link Tag' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(activeOption()).toBe('Ada Lovelace'))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(activeOption()).toBeNull())
    await user.keyboard('{Enter}')
    expect(serverAction.mock.calls.filter(([input]) => input.action === 'addRelated')).toHaveLength(
      1,
    )
    finish({ added: false })
    await waitFor(() => expect(activeOption()).toBe('Ada Lovelace'))
  })
})

describe('a control tied to its label', () => {
  const noop = () => {}

  it('names the relationship trigger by its label and shows its value', () => {
    renderPicker({ value: 'u2', id: 'f-author' })
    const trigger = screen.getByRole('button', { name: 'Author Alan Turing' })
    expect(trigger).toHaveAttribute('id', 'f-author')
    expect(screen.getByLabelText(/Author/)).toBe(trigger)
  })

  it('names the date and time triggers by their labels', () => {
    render(
      <>
        <TimestampField name="publishedAt" value={null} onChange={noop} label="Published At" />
        <CalendarDayField name="birthday" value={null} onChange={noop} label="Birthday" />
      </>,
    )
    expect(
      screen.getByRole('button', { name: 'Published At Pick a date and time' }),
    ).toHaveAttribute('id', 'publishedAt')
    expect(screen.getByRole('button', { name: 'Birthday Pick a date' })).toHaveAttribute(
      'id',
      'birthday',
    )
  })

  it('gives the date picker a named popover, month buttons and day buttons', async () => {
    const user = userEvent.setup()
    render(
      <TimestampField
        name="publishedAt"
        value="2026-09-11T10:00:00.000Z"
        onChange={noop}
        label="Published At"
      />,
    )

    await user.click(screen.getByRole('button', { name: /^Published At/ }))
    expect(
      screen.getByRole('dialog', { name: 'Published At: choose date and time' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /September 11th, 2026/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('spinbutton', { name: 'Hours' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Minutes' })).toBeInTheDocument()
  })

  it('gives a drawer and the form under it different ids for the same field name', () => {
    const field: SerializableFieldConfig = { type: 'text' }
    render(
      <>
        <FieldRenderer fieldName="title" fieldConfig={field} value="" onChange={noop} />
        <FieldRenderer fieldName="title" fieldConfig={field} value="" onChange={noop} />
      </>,
    )

    const [first, second] = screen.getAllByLabelText('Title')
    expect(first.id).not.toBe(second.id)
    expect(first).toHaveAttribute('name', 'title')
    expect(second).toHaveAttribute('name', 'title')
  })

  it('hands a third-party field an id alongside its name', () => {
    const CustomField = ({ id, name }: { id?: string; name?: string }) => (
      <span data-testid="custom">{`${name}|${id}`}</span>
    )
    render(
      <FieldRenderer
        fieldName="colour"
        fieldConfig={{ type: 'text', ui: { component: CustomField } }}
        value=""
        onChange={noop}
      />,
    )
    expect(screen.getByTestId('custom').textContent).toMatch(/^colour\|.+-colour$/)
  })

  it('names the password controls', async () => {
    const user = userEvent.setup()
    render(<PasswordField name="secret" value={{ isSet: true }} onChange={noop} label="Secret" />)

    await user.click(screen.getByRole('button', { name: 'Secret Change Password' }))
    const toggle = screen.getByRole('button', { name: 'Show Secret' })
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide Secret' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('keeps focus on the page when the change-password button swaps for its inputs', async () => {
    const user = userEvent.setup()
    render(<PasswordField name="secret" value={{ isSet: true }} onChange={noop} label="Secret" />)

    screen.getByRole('button', { name: 'Secret Change Password' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Secret')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Secret Change Password' })).toHaveFocus()
  })

  it.each([
    ['file', FileField, 'Remove Document'],
    ['image', ImageField, 'Remove Document'],
  ])('keeps a %s field’s label and error on its file input, not Remove', (_, Field, removeName) => {
    render(
      <Field
        name="doc"
        id="f-doc"
        label="Document"
        value={{
          url: '/a.png',
          originalFilename: 'a.png',
          filename: 'a.png',
          size: 1,
          mimeType: 'image/png',
          width: 1,
          height: 1,
          storageProvider: 'local',
          uploadedAt: '2026-11-06T00:00:00.000Z',
        }}
        onChange={noop}
        error="Too large"
      />,
    )

    const input = screen.getByLabelText('Document')
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Too large')
    expect(screen.getByRole('button', { name: removeName })).not.toHaveAttribute('aria-invalid')
  })

  it('hands focus to the file input when Remove takes itself away', async () => {
    function Harness() {
      const [value, setValue] = React.useState<File | null>(new File(['x'], 'a.txt'))
      return <FileField name="doc" label="Document" value={value} onChange={() => setValue(null)} />
    }
    const user = userEvent.setup()
    render(<Harness />)

    screen.getByRole('button', { name: 'Remove Document' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Document')).toHaveFocus()
  })

  it('names the file field’s remove button', () => {
    render(
      <FileField name="doc" label="Document" value={new File(['x'], 'a.txt')} onChange={noop} />,
    )
    expect(screen.getByRole('button', { name: 'Remove Document' })).toBeInTheDocument()
  })

  it('keeps focus on the page when a clear button removes itself', async () => {
    const user = userEvent.setup()
    render(
      <>
        <SearchBar defaultValue="hello" onClear={noop} />
        <FilterBuilder suggestions={[]} defaultValue="world" onApply={noop} />
      </>,
    )

    const [searchBox, filterBox] = screen.getAllByRole('textbox', { name: 'Search' })
    screen.getByRole('button', { name: 'Clear search' }).focus()
    await user.keyboard('{Enter}')
    expect(searchBox).toHaveFocus()

    screen.getByRole('button', { name: 'Clear filter text' }).focus()
    await user.keyboard('{Enter}')
    expect(filterBox).toHaveFocus()
  })

  it.each([
    ['Cancel', () => screen.getByRole('button', { name: 'Keep it' }).click()],
    ['Escape', () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })],
  ])('gives focus back to the opener after a confirm dialog closes by %s', async (_, close) => {
    function Harness() {
      const [open, setOpen] = React.useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Delete it</button>
          <ConfirmDialog
            isOpen={open}
            title="Sure?"
            message="Really?"
            cancelLabel="Keep it"
            onConfirm={noop}
            onCancel={() => setOpen(false)}
          />
        </>
      )
    }
    const user = userEvent.setup()
    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Delete it' })
    opener.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep it' })).toBeVisible())

    close()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('names the search bar’s input and its clear button', async () => {
    const user = userEvent.setup()
    render(<SearchBar defaultValue="hello" onClear={noop} />)

    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('')
  })
})

describe('sort headers', () => {
  const listProps: React.ComponentProps<typeof ListViewClient> = {
    items: [
      { id: 'aaaa-1', title: 'First post', views: 1, status: 'draft' },
      { id: 'aaaa-2', title: '', views: 2, status: 'draft' },
    ],
    fieldTypes: { title: 'text', views: 'integer', status: 'select' },
    relationshipRefs: {},
    sortableFields: { title: true, views: true },
    listKey: 'Post',
    urlKey: 'post',
    basePath: '/admin',
    page: 3,
    pageSize: 10,
    total: 22,
  }

  beforeEach(() => mockPush.mockClear())

  it('sorts from the keyboard through a real button in the header cell', async () => {
    const user = userEvent.setup()
    render(<ListViewClient {...listProps} />)

    const button = within(screen.getByRole('columnheader', { name: 'Title' })).getByRole('button', {
      name: 'Title',
    })
    button.focus()
    await user.keyboard('{Enter}')
    expect(mockPush).toHaveBeenCalledWith('/admin/post?sort=title%3Aasc&page=1&pageSize=10')
  })

  it('keeps a column the server cannot sort a plain header', () => {
    render(<ListViewClient {...listProps} />)
    expect(
      within(screen.getByRole('columnheader', { name: 'Status' })).queryByRole('button'),
    ).not.toBeInTheDocument()
  })

  it('reports the direction on the header cell, and keeps the arrow out of the name', () => {
    render(<ListViewClient {...listProps} initialSort={{ field: 'views', direction: 'desc' }} />)

    const header = screen.getByRole('columnheader', { name: /^Views/ })
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(within(header).getByRole('button', { name: 'Views' })).toHaveTextContent('Views↓')
    expect(screen.getByRole('columnheader', { name: 'Title' })).not.toHaveAttribute('aria-sort')
  })

  it('does the same in the standalone table', async () => {
    const user = userEvent.setup()
    render(
      <ListTable
        items={[
          { id: '1', title: 'B' },
          { id: '2', title: 'A' },
        ]}
        fieldTypes={{ title: 'text' }}
        relationshipRefs={{}}
      />,
    )

    const header = screen.getByRole('columnheader', { name: 'Title' })
    within(header).getByRole('button', { name: 'Title' }).focus()
    await user.keyboard('{Enter}')
    expect(header).toHaveAttribute('aria-sort', 'ascending')
  })

  it('names a row’s checkbox after the row, not its id', () => {
    render(<ListViewClient {...listProps} canDelete labelColumn="title" />)

    expect(screen.getByRole('checkbox', { name: 'Select First post' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select row 22' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /aaaa/ })).not.toBeInTheDocument()
  })

  it('falls back to the row’s position when the list’s label is its id', () => {
    render(<ListViewClient {...listProps} canDelete labelColumn="id" />)
    expect(screen.getByRole('checkbox', { name: 'Select row 21' })).toBeInTheDocument()
  })
})

describe('after a failed submit', () => {
  const fields: Record<string, SerializableFieldConfig> = {
    title: { type: 'text' },
    summary: { type: 'text' },
    meta: { type: 'json' },
    author: { type: 'relationship', ref: 'User.posts' },
    publishedAt: { type: 'timestamp' },
  }

  function formProps(result: unknown): ItemFormClientProps {
    return {
      listKey: 'Post',
      urlKey: 'post',
      mode: 'edit',
      fields,
      initialData: { title: 'Hello', summary: 'Old', meta: null, author: null, publishedAt: null },
      itemId: 'p1',
      basePath: '/admin',
      serverAction: vi.fn(async () => result),
      relationshipData: { author: people },
    }
  }

  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Summary'), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
  }

  it('focuses the first field with an error and ties it to the message', async () => {
    const user = userEvent.setup()
    render(
      <ItemFormClient
        {...formProps({
          success: false,
          error: 'Validation failed',
          fieldErrors: { summary: 'Too short', title: 'Taken' },
        })}
      />,
    )

    await submit(user)

    const title = screen.getByLabelText('Title')
    await waitFor(() => expect(title).toHaveFocus())
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAccessibleDescription('Taken')
    expect(screen.getByLabelText('Summary')).toHaveAccessibleDescription('Too short')
    expect(screen.getByLabelText('Meta')).not.toHaveAttribute('aria-invalid')
  })

  it('lands on a button control when that is the field with the error', async () => {
    const user = userEvent.setup()
    render(
      <ItemFormClient
        {...formProps({
          success: false,
          error: 'Validation failed',
          fieldErrors: { author: 'Pick someone', publishedAt: 'Pick a date' },
        })}
      />,
    )

    await submit(user)

    const trigger = screen.getByRole('button', { name: /^Author/ })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAccessibleDescription('Pick someone')
    expect(screen.getByRole('button', { name: /^Published At/ })).toHaveAccessibleDescription(
      'Pick a date',
    )
  })

  it('focuses the banner when the error belongs to no field', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...formProps({ success: false, error: 'Nope' })} />)

    await submit(user)

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('Nope')
    await waitFor(() => expect(banner).toHaveFocus())
  })

  it('falls back to the banner when the field with the error has no control on the form', async () => {
    const user = userEvent.setup()
    render(
      <ItemFormClient
        {...formProps({ success: false, error: 'Nope', fieldErrors: { hidden: 'Bad' } })}
      />,
    )

    await submit(user)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  })

  it('focuses a third-party field that marks nothing invalid, through its first control', async () => {
    const user = userEvent.setup()
    const Plain = ({ label }: { label?: string }) => <input aria-label={label} />
    render(
      <ItemFormClient
        {...formProps({ success: false, error: 'Nope', fieldErrors: { custom: 'Bad' } })}
        fields={{ ...fields, custom: { type: 'text', ui: { component: Plain } } }}
      />,
    )

    await submit(user)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Custom' })).toHaveFocus())
  })

  it('prefers the invalid control over the first one in a field', async () => {
    const user = userEvent.setup()
    const Pair = () => (
      <>
        <input aria-label="First" />
        <input aria-label="Second" aria-invalid="true" />
      </>
    )
    render(
      <ItemFormClient
        {...formProps({ success: false, error: 'Nope', fieldErrors: { custom: 'Bad' } })}
        fields={{ ...fields, custom: { type: 'text', ui: { component: Pair } } }}
      />,
    )

    await submit(user)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toHaveFocus())
  })

  it('skips disabled and hidden controls for the next one in the field', async () => {
    const user = userEvent.setup()
    const Crowded = () => (
      <>
        <input aria-label="Disabled" aria-invalid="true" disabled />
        <input aria-label="Out of the tab order" aria-invalid="true" tabIndex={-1} />
        <div hidden>
          <input aria-label="Hidden" aria-invalid="true" />
        </div>
        <input aria-label="Usable" />
      </>
    )
    render(
      <ItemFormClient
        {...formProps({ success: false, error: 'Nope', fieldErrors: { custom: 'Bad' } })}
        fields={{ ...fields, custom: { type: 'text', ui: { component: Crowded } } }}
      />,
    )

    await submit(user)

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Usable' })).toHaveFocus())
  })

  it('never lands on a button a field did not mark invalid, which may be its Remove', async () => {
    const user = userEvent.setup()
    const OnlyRemove = () => <button type="button">Remove</button>
    render(
      <ItemFormClient
        {...formProps({ success: false, error: 'Nope', fieldErrors: { custom: 'Bad' } })}
        fields={{ ...fields, custom: { type: 'text', ui: { component: OnlyRemove } } }}
      />,
    )

    await submit(user)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  })

  it('lands on a file field’s input, never its Remove button', async () => {
    const user = userEvent.setup()
    const upload = new File(['x'], 'a.txt')
    render(
      <ItemFormClient
        {...formProps({ success: false, error: 'Nope', fieldErrors: { doc: 'Too large' } })}
        fields={{ ...fields, doc: { type: 'file' } }}
        initialData={{ title: 'Hello', summary: 'Old', doc: upload }}
      />,
    )

    await submit(user)

    const input = screen.getByLabelText('Doc')
    await waitFor(() => expect(input).toHaveFocus())
    expect(input).toHaveAttribute('type', 'file')
  })

  it('shows a server error beside an unparseable draft', async () => {
    const user = userEvent.setup()
    render(<JsonField name="meta" value={null} onChange={() => {}} label="Meta" error="Taken" />)

    const meta = screen.getByLabelText('Meta')
    await user.click(meta)
    await user.paste('{oops')

    expect(meta).toHaveAccessibleDescription(/Invalid JSON.*Taken/)
  })

  it('leaves a refused submit to the field that refused it', async () => {
    const user = userEvent.setup()
    const props = formProps({ success: true, data: {} })
    render(<ItemFormClient {...props} />)

    const meta = screen.getByLabelText('Meta')
    await user.click(meta)
    await user.paste('{oops')
    expect(meta).toHaveAttribute('aria-invalid', 'true')
    expect(meta).toHaveAccessibleDescription(/Invalid JSON/)

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(meta).toHaveFocus()
    expect(props.serverAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('describes a field by its help text and its error together', () => {
    render(
      <JsonField
        name="meta"
        value={null}
        onChange={() => {}}
        label="Meta"
        helpText="Any JSON"
        error="Required"
      />,
    )
    expect(screen.getByLabelText('Meta')).toHaveAccessibleDescription('Required Any JSON')
  })
})

describe('the admin frame', () => {
  it('starts with a skip link to the focusable main region', () => {
    render(
      <AdminFrame topBar={<button>Menu</button>} sidebar={<nav>Nav</nav>}>
        <p>Content</p>
      </AdminFrame>,
    )

    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveTextContent('Skip to main content')
    const main = screen.getByRole('main')
    expect(links[0]).toHaveAttribute('href', `#${main.id}`)
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(
      links[0].compareDocumentPosition(screen.getByRole('button', { name: 'Menu' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
