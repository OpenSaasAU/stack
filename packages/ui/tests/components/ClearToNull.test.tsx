import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { json, select, text } from '@opensaas/stack-core/fields'
import type { FieldConfig } from '@opensaas/stack-core'
import { ItemFormClient } from '../../src/components/ItemFormClient.js'
import { RelationshipCreateDrawer } from '../../src/components/RelationshipCreateDrawer.js'
import { ItemCreateForm } from '../../src/components/standalone/ItemCreateForm.js'
import { ItemEditForm } from '../../src/components/standalone/ItemEditForm.js'
import { SelectField } from '../../src/components/fields/SelectField.js'
import { TextField } from '../../src/components/fields/TextField.js'
import { serializeFieldConfigs } from '../../src/lib/serializeFieldConfig.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

const tiers = [
  { label: 'Gold', value: 'gold' },
  { label: 'Silver', value: 'silver' },
]

const declared: Record<string, FieldConfig> = {
  title: text(),
  slug: text({ isIndexed: 'unique' }),
  body: text({ ui: { displayMode: 'textarea' } }),
  code: text({ db: { isNullable: false } }),
  meta: json(),
  tier: select({ options: tiers }),
  rank: select({ options: tiers, defaultValue: 'gold' }),
  grade: select({ options: tiers, defaultValue: 'gold', db: { isNullable: true } }),
  level: select({ options: tiers, validation: { isRequired: true }, db: { isNullable: true } }),
}

const stored = {
  title: 'Hello',
  slug: 'hello',
  body: 'Line one',
  code: 'abc',
  meta: { keep: true },
  tier: 'gold',
  rank: 'gold',
  grade: 'silver',
  level: 'gold',
}

type ActionResult =
  | { success: true; data: unknown }
  | { success: false; error: string; fieldErrors: Record<string, string> }

const serverAction = vi.fn(async (): Promise<ActionResult> => ({ success: true, data: {} }))

function renderEdit(initialData: Record<string, unknown> = stored) {
  return render(
    <ItemFormClient
      listKey="Post"
      urlKey="post"
      mode="edit"
      fields={serializeFieldConfigs(declared)}
      initialData={initialData}
      itemId="p1"
      basePath="/admin"
      serverAction={serverAction}
    />,
  )
}

const save = () => screen.getByRole('button', { name: 'Save' })

function expectWrote(data: Record<string, unknown>) {
  expect(serverAction).toHaveBeenCalledTimes(1)
  expect(serverAction).toHaveBeenCalledWith({ listKey: 'Post', action: 'update', id: 'p1', data })
}

async function openSelect(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  const trigger = screen.getByLabelText(name, { selector: 'button' })
  trigger.focus()
  await user.keyboard('{Enter}')
  return trigger
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  serverAction.mockClear()
  mockPush.mockClear()
  mockRefresh.mockClear()
})

describe('emptying text', () => {
  it('stores null on a nullable column', async () => {
    const user = userEvent.setup()
    renderEdit()

    await user.clear(screen.getByLabelText('Slug'))
    await user.click(save())

    expectWrote({ slug: null })
  })

  it('stores null from a multi-line control', async () => {
    const user = userEvent.setup()
    renderEdit()

    await user.clear(screen.getByLabelText('Body'))
    await user.click(save())

    expectWrote({ body: null })
  })

  it("keeps '' on a NOT NULL column", async () => {
    const user = userEvent.setup()
    renderEdit()

    await user.clear(screen.getByLabelText('Code'))
    await user.click(save())

    expectWrote({ code: '' })
  })

  it("keeps '' on a required field so its validation still answers", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextField name="t" label="T" value="x" onChange={onChange} nullable required />)

    await user.clear(screen.getByLabelText(/^T/))

    expect(onChange).toHaveBeenCalledWith('')
  })

  it('writes nothing for a stored empty string nobody touched', async () => {
    const user = userEvent.setup()
    renderEdit({ ...stored, slug: '' })

    await user.type(screen.getByLabelText('Title'), '!')
    await user.click(save())

    expectWrote({ title: 'Hello!' })
  })

  it('writes nothing for a never-set value on an unrelated save', async () => {
    const user = userEvent.setup()
    renderEdit({ ...stored, slug: null, body: null, meta: null, tier: null })

    await user.type(screen.getByLabelText('Title'), '!')
    await user.click(save())

    expectWrote({ title: 'Hello!' })
  })

  it('takes the unchanged path when a never-set value is typed and erased', async () => {
    const user = userEvent.setup()
    renderEdit({ ...stored, slug: null })

    await user.type(screen.getByLabelText('Slug'), 'x')
    await user.clear(screen.getByLabelText('Slug'))
    await user.click(save())

    expect(serverAction).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/admin/post')
  })
})

describe('emptying JSON', () => {
  it('stores null', async () => {
    const user = userEvent.setup()
    renderEdit()

    await user.clear(screen.getByLabelText('Meta'))
    await user.click(save())

    expectWrote({ meta: null })
  })

  it('treats a whitespace-only box as empty', async () => {
    const user = userEvent.setup()
    renderEdit()

    const box = screen.getByLabelText('Meta')
    await user.clear(box)
    await user.type(box, '   ')
    await user.click(save())

    expectWrote({ meta: null })
  })

  it('sends the same value as typing the literal null', async () => {
    const user = userEvent.setup()
    renderEdit()

    const box = screen.getByLabelText('Meta')
    await user.clear(box)
    await user.click(box)
    await user.paste('null')
    await user.click(save())

    expectWrote({ meta: null })
  })

  it('abandons an unparseable draft once the box is emptied', async () => {
    const user = userEvent.setup()
    renderEdit()

    const box = screen.getByLabelText('Meta')
    await user.clear(box)
    await user.click(box)
    await user.paste('{"a":')
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument()

    await user.clear(box)
    await user.click(save())

    expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument()
    expectWrote({ meta: null })
  })

  it('shows the server refusal of a required value on the field', async () => {
    const user = userEvent.setup()
    serverAction.mockResolvedValueOnce({
      success: false,
      error: 'Validation failed',
      fieldErrors: { meta: 'Meta is required' },
    })
    renderEdit()

    await user.clear(screen.getByLabelText('Meta'))
    await user.click(save())

    expect(screen.getByText('Meta is required')).toHaveAttribute('data-slot', 'field-error')
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('clearing a select', () => {
  it('stores null and shows the placeholder', async () => {
    const user = userEvent.setup()
    renderEdit()

    const trigger = await openSelect(user, 'Tier')
    await user.click(await screen.findByRole('option', { name: 'Clear selection' }))

    expect(trigger).toHaveTextContent('Select an option...')
    await user.click(save())
    expectWrote({ tier: null })
  })

  it('shows the placeholder when a value picked from empty is cleared again', async () => {
    const user = userEvent.setup()
    renderEdit({ ...stored, tier: null })

    const trigger = await openSelect(user, 'Tier')
    await user.click(await screen.findByRole('option', { name: 'Gold' }))
    expect(trigger).toHaveTextContent('Gold')

    await openSelect(user, 'Tier')
    await user.click(await screen.findByRole('option', { name: 'Clear selection' }))

    expect(trigger).toHaveTextContent('Select an option...')
  })

  it('stores null rather than the default on a nullable column', async () => {
    const user = userEvent.setup()
    renderEdit()

    await openSelect(user, 'Grade')
    await user.click(await screen.findByRole('option', { name: 'Clear selection' }))
    await user.click(save())

    expectWrote({ grade: null })
  })

  it.each([
    ['a default on a NOT NULL column', 'Rank'],
    ['a required field on a nullable column', /^Level/],
  ])('offers no clear with %s', async (_, name) => {
    const user = userEvent.setup()
    renderEdit()

    await openSelect(user, name)

    expect(await screen.findByRole('option', { name: 'Silver' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Clear selection' })).not.toBeInTheDocument()
  })

  it('offers no clear with nothing selected', async () => {
    const user = userEvent.setup()
    render(
      <SelectField
        name="tier"
        label="Tier"
        value={null}
        onChange={vi.fn()}
        options={tiers}
        nullable
      />,
    )

    await openSelect(user, 'Tier')

    expect(await screen.findByRole('option', { name: 'Gold' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Clear selection' })).not.toBeInTheDocument()
  })
})

describe('the create and standalone forms', () => {
  const clearBoth = async (
    user: ReturnType<typeof userEvent.setup>,
    getByLabelText: (label: string) => HTMLElement,
  ) => {
    const slug = getByLabelText('Slug')
    await user.type(slug, 'x')
    await user.clear(slug)
    const meta = getByLabelText('Meta')
    await user.click(meta)
    await user.paste('{}')
    await user.clear(meta)
  }

  const createFields: Record<string, FieldConfig> = { slug: declared.slug, meta: declared.meta }

  it('ItemFormClient create sends null for a touched-and-emptied value', async () => {
    const user = userEvent.setup()
    render(
      <ItemFormClient
        listKey="Post"
        urlKey="post"
        mode="create"
        fields={serializeFieldConfigs(createFields)}
        basePath="/admin"
        serverAction={serverAction}
      />,
    )

    await clearBoth(user, screen.getByLabelText)
    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'create',
      data: { slug: null, meta: null },
    })
  })

  it('ItemCreateForm clears from raw field configs', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => ({ success: true }))
    render(<ItemCreateForm fields={createFields} onSubmit={onSubmit} />)

    await clearBoth(user, screen.getByLabelText)
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(onSubmit).toHaveBeenCalledWith({ slug: null, meta: null })
  })

  it('ItemCreateForm clears from configs a server component already serialised', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => ({ success: true }))
    render(<ItemCreateForm fields={serializeFieldConfigs(createFields)} onSubmit={onSubmit} />)

    await clearBoth(user, screen.getByLabelText)
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(onSubmit).toHaveBeenCalledWith({ slug: null, meta: null })
  })

  it('ItemEditForm sends null', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => ({ success: true }))
    render(
      <ItemEditForm
        fields={createFields}
        initialData={{ slug: 'hello', meta: { keep: true } }}
        onSubmit={onSubmit}
      />,
    )

    await user.clear(screen.getByLabelText('Slug'))
    await user.clear(screen.getByLabelText('Meta'))
    await user.click(save())

    expect(onSubmit).toHaveBeenCalledWith({ slug: null, meta: null })
  })

  it('the relationship create drawer sends null', async () => {
    const user = userEvent.setup()
    const drawerAction = vi.fn(async () => ({ created: true, id: 'n1' }))
    render(
      <RelationshipCreateDrawer
        relatedListKey="Post"
        title="Post"
        fields={serializeFieldConfigs(createFields)}
        backReferenceField="author"
        parentId="u1"
        basePath="/admin"
        serverAction={drawerAction}
      />,
    )

    await user.click(screen.getByRole('button', { name: /add post/i }))
    const dialog = within(screen.getByRole('dialog'))
    await clearBoth(user, dialog.getByLabelText)
    await user.click(dialog.getByRole('button', { name: 'Create' }))

    expect(drawerAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'createRelated', data: { slug: null, meta: null } }),
    )
  })
})
