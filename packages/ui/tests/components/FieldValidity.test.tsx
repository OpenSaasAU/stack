import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decimal, json, password, text } from '@opensaas/stack-core/fields'
import { ItemFormClient, type ItemFormClientProps } from '../../src/components/ItemFormClient.js'
import { RelationshipCreateDrawer } from '../../src/components/RelationshipCreateDrawer.js'
import { ItemCreateForm } from '../../src/components/standalone/ItemCreateForm.js'
import { ItemEditForm } from '../../src/components/standalone/ItemEditForm.js'
import { BigIntField } from '../../src/components/fields/BigIntField.js'
import { DecimalField } from '../../src/components/fields/DecimalField.js'
import { JsonField } from '../../src/components/fields/JsonField.js'
import { PasswordField } from '../../src/components/fields/PasswordField.js'
import { useFieldValidity } from '../../src/components/fields/index.js'
import { FieldValidityContext } from '../../src/lib/fieldValidity.js'
import {
  projectFieldConfigs,
  type SerializableFieldConfig,
} from '../../src/lib/serializeFieldConfig.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

const fields: Record<string, SerializableFieldConfig> = {
  title: { type: 'text' },
  meta: { type: 'json' },
  price: { type: 'decimal' },
  views: { type: 'bigInt' },
  secret: { type: 'password' },
}

const initialData = {
  title: 'Hello',
  meta: { keep: true },
  price: '1.50',
  views: '7',
  secret: { isSet: true },
}

const serverAction = vi.fn(async () => ({ success: true, data: {} }))

function editProps(overrides: Partial<ItemFormClientProps> = {}): ItemFormClientProps {
  return {
    listKey: 'Post',
    urlKey: 'post',
    mode: 'edit',
    fields,
    initialData,
    itemId: 'p1',
    basePath: '/admin',
    serverAction,
    ...overrides,
  }
}

const save = () => screen.getByRole('button', { name: 'Save' })

function expectNothingWritten() {
  expect(serverAction).not.toHaveBeenCalled()
  expect(mockPush).not.toHaveBeenCalled()
}

async function replaceText(user: ReturnType<typeof userEvent.setup>, label: RegExp, next: string) {
  const input = screen.getByLabelText(label)
  await user.clear(input)
  await user.click(input)
  await user.paste(next)
  return input
}

beforeEach(() => {
  serverAction.mockClear()
  mockPush.mockClear()
  mockRefresh.mockClear()
})

describe('a parsing field holding input it cannot commit', () => {
  it.each([
    ['JSON', /^Meta/, '{"keep":', /Invalid JSON/],
    ['decimal', /^Price/, '9.9x', /Price must be a decimal value/],
    ['bigInt', /^Views/, '1e9', /Views must be an integer/],
  ])('%s stays on the page with its error and its text', async (_, label, bad, message) => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    const input = await replaceText(user, label, bad)
    await user.click(save())

    expectNothingWritten()
    expect(screen.getByText(message)).toHaveAttribute('data-slot', 'field-error')
    expect(input).toHaveValue(bad)
    expect(input).toHaveFocus()
  })

  it('submits the corrected value once the input parses again', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await replaceText(user, /^Price/, '9.9x')
    await user.click(save())
    expectNothingWritten()

    await replaceText(user, /^Price/, '9.9')
    await user.click(save())

    expect(serverAction).toHaveBeenCalledWith({
      listKey: 'Post',
      action: 'update',
      id: 'p1',
      data: { price: '9.9' },
    })
    expect(screen.queryByText(/must be a decimal value/)).not.toBeInTheDocument()
  })

  it('takes the unchanged path once corrected back to the loaded value', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await replaceText(user, /^Views/, '7x')
    await user.click(save())
    expect(mockPush).not.toHaveBeenCalled()

    await replaceText(user, /^Views/, '7')
    await user.click(save())

    expect(mockPush).toHaveBeenCalledWith('/admin/post')
  })

  it('stops blocking when the field is emptied', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    const input = await replaceText(user, /^Views/, '1e9')
    await user.clear(input)
    await user.click(save())

    expect(serverAction).toHaveBeenCalledTimes(1)
  })

  it('stops blocking when the committed value changes underneath it', async () => {
    const clearMark = vi.fn()
    const markInvalid = vi.fn(() => clearMark)
    const user = userEvent.setup()
    const field = (value: unknown) => (
      <FieldValidityContext value={{ markInvalid }}>
        <JsonField name="meta" label="Meta" value={value} onChange={() => {}} />
      </FieldValidityContext>
    )
    const { rerender } = render(field({ a: 1 }))

    await replaceText(user, /^Meta/, '{"keep":')
    expect(markInvalid).toHaveBeenCalledTimes(1)
    expect(clearMark).not.toHaveBeenCalled()

    rerender(field({ a: 2 }))

    expect(clearMark).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Invalid JSON/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Meta/)).toHaveValue(JSON.stringify({ a: 2 }, null, 2))
  })
})

describe('a parsing field outside an item form', () => {
  it.each([
    [
      'JSON',
      <JsonField key="f" name="f" label="F" value={{ keep: true }} onChange={() => {}} />,
      JSON.stringify({ keep: true }, null, 2),
    ],
    [
      'decimal',
      <DecimalField key="f" name="f" label="F" value="1.50" onChange={() => {}} />,
      '1.50',
    ],
    ['bigInt', <BigIntField key="f" name="f" label="F" value="7" onChange={() => {}} />, '7'],
  ])('%s reverts on blur, so the screen matches the value', async (_, field, shown) => {
    const user = userEvent.setup()
    render(
      <form>
        {field}
        <button type="button">Elsewhere</button>
      </form>,
    )

    const input = await replaceText(user, /^F/, 'oops')
    expect(input).toHaveValue('oops')
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))

    expect(input).toHaveValue(shown)
    expect(document.querySelector('[data-slot="field-error"]')).toBeNull()
  })
})

describe('which field the form focuses', () => {
  it('is the first in declaration order, not the first to turn invalid', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await replaceText(user, /^Views/, '1e9')
    const meta = await replaceText(user, /^Meta/, 'nope')
    await user.click(save())

    expect(meta).toHaveFocus()
    expectNothingWritten()
  })
})

describe('a password that is not confirmed', () => {
  async function startChange(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Change Password/ }))
  }

  it('refuses a mismatch and focuses the confirm box', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await startChange(user)
    await user.type(screen.getByLabelText(/^Secret/), 'Password123!')
    await user.type(screen.getByLabelText(/^Confirm Secret/), 'Different999')
    await user.click(save())

    expectNothingWritten()
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Confirm Secret/)).toHaveFocus()
  })

  it('refuses an empty confirm box and only then says so', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await startChange(user)
    await user.type(screen.getByLabelText(/^Secret/), 'Password123!')
    expect(screen.queryByText('Re-enter secret to confirm')).not.toBeInTheDocument()
    await user.click(save())

    expectNothingWritten()
    expect(screen.getByText('Re-enter secret to confirm')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Confirm Secret/)).toHaveFocus()
  })

  it('writes the password once the boxes match', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await startChange(user)
    await user.type(screen.getByLabelText(/^Secret/), 'Password123!')
    await user.type(screen.getByLabelText(/^Confirm Secret/), 'Password123!')
    await user.click(save())

    expect(serverAction).toHaveBeenCalledWith(
      expect.objectContaining({ data: { secret: 'Password123!' } }),
    )
  })

  it('cancelling a typed change clears the value and the invalid state', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await startChange(user)
    await user.type(screen.getByLabelText(/^Secret/), 'Password123!')
    await user.type(screen.getByLabelText(/^Confirm Secret/), 'Different999')
    await user.click(save())
    expectNothingWritten()

    const [cancelPasswordChange] = screen.getAllByRole('button', { name: 'Cancel' })
    await user.click(cancelPasswordChange)
    expect(screen.getByRole('button', { name: /Change Password/ })).toBeInTheDocument()
    await user.click(save())

    expect(serverAction).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/admin/post')
  })

  it('is not told about a refusal another field caused', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await replaceText(user, /^Price/, '9.9x')
    await user.click(save())
    expectNothingWritten()
    await replaceText(user, /^Price/, '9.9')

    await startChange(user)
    await user.type(screen.getByLabelText(/^Secret/), 'P')

    expect(screen.queryByText('Re-enter secret to confirm')).not.toBeInTheDocument()
  })

  it('forgets a refusal once confirmed, so retyping is not flagged mid-word', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await startChange(user)
    await user.type(screen.getByLabelText(/^Secret/), 'abc')
    await user.click(save())
    expect(screen.getByText('Re-enter secret to confirm')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^Confirm Secret/), 'abc')
    await user.clear(screen.getByLabelText(/^Confirm Secret/))
    await user.clear(screen.getByLabelText(/^Secret/))
    await user.type(screen.getByLabelText(/^Secret/), 'x')

    expect(screen.queryByText('Re-enter secret to confirm')).not.toBeInTheDocument()
  })

  it('never puts an unconfirmed password in the data the form would send', async () => {
    function Toggled(props: React.ComponentProps<typeof PasswordField>) {
      const [shown, setShown] = React.useState(true)
      return (
        <>
          {shown && <PasswordField {...props} />}
          <button type="button" onClick={() => setShown(false)}>
            Hide
          </button>
        </>
      )
    }

    const user = userEvent.setup()
    render(
      <ItemFormClient
        {...editProps({
          fields: {
            title: { type: 'text' },
            secret: { type: 'password', ui: { component: Toggled } },
          },
        })}
      />,
    )

    await startChange(user)
    await user.type(screen.getByLabelText(/^Secret/), 'UnconfirmedPw1')
    await user.type(screen.getByLabelText(/^Confirm Secret/), 'Different999')
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    await replaceText(user, /^Title/, 'Changed')
    await user.click(save())

    expect(serverAction).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: 'Changed' } }),
    )
  })

  it('commits only a matching pair, whichever box is typed last', async () => {
    const onChange = vi.fn()
    const sentinel = { isSet: true }
    const user = userEvent.setup()
    render(<PasswordField name="secret" label="Secret" value={sentinel} onChange={onChange} />)

    await startChange(user)
    await user.type(screen.getByLabelText(/^Confirm Secret/), 'ab')
    await user.type(screen.getByLabelText(/^Secret/), 'ab')
    expect(onChange.mock.calls.map(([value]) => value)).toEqual([
      sentinel,
      sentinel,
      sentinel,
      'ab',
    ])

    await user.type(screen.getByLabelText(/^Secret/), 'c')
    expect(onChange).toHaveBeenLastCalledWith(sentinel)
  })

  it('commits on every keystroke when there is no confirm box', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <PasswordField
        name="secret"
        label="Secret"
        value=""
        onChange={onChange}
        showConfirm={false}
      />,
    )

    await user.type(screen.getByLabelText(/^Secret/), 'ab')

    expect(onChange).toHaveBeenLastCalledWith('ab')
  })

  it('does not ask an untouched change to be confirmed', async () => {
    const user = userEvent.setup()
    render(<ItemFormClient {...editProps()} />)

    await startChange(user)
    await user.click(save())

    expect(mockPush).toHaveBeenCalledWith('/admin/post')
  })

  it('applies with no loaded sentinel, where there is no Change Password step', async () => {
    const user = userEvent.setup()
    render(
      <ItemFormClient {...editProps({ mode: 'create', initialData: {}, itemId: undefined })} />,
    )

    await user.type(screen.getByLabelText(/^Secret/), 'Password123!')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(serverAction).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^Confirm Secret/)).toHaveFocus()
  })
})

describe('invalid state that outlives its reason', () => {
  it('stops blocking when the invalid field unmounts', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ItemFormClient {...editProps()} />)

    await replaceText(user, /^Price/, '9.9x')
    await replaceText(user, /^Title/, 'Changed')
    await user.click(save())
    expectNothingWritten()

    const { price: _price, ...withoutPrice } = fields
    rerender(<ItemFormClient {...editProps({ fields: withoutPrice })} />)
    await user.click(save())

    expect(serverAction).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: 'Changed' } }),
    )
  })

  it('stops blocking when the form is reset by remounting it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ItemFormClient key="a" {...editProps()} />)

    await replaceText(user, /^Price/, '9.9x')
    rerender(<ItemFormClient key="b" {...editProps()} />)

    expect(screen.queryByText(/must be a decimal value/)).not.toBeInTheDocument()
    await user.click(save())

    expect(mockPush).toHaveBeenCalledWith('/admin/post')
  })

  it('stops blocking when the field turns read-only', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ItemFormClient {...editProps()} />)

    await replaceText(user, /^Price/, '9.9x')
    rerender(
      <ItemFormClient
        {...editProps({ fields: { ...fields, price: { type: 'decimal', readOnly: true } } })}
      />,
    )
    await user.click(save())

    expect(mockPush).toHaveBeenCalledWith('/admin/post')
  })
})

describe('every form that submits', () => {
  it('blocks the relationship create drawer, and a reopened drawer starts clean', async () => {
    const drawerAction = vi.fn(async () => ({ created: true, id: 'p1' }))
    const user = userEvent.setup()
    render(
      <RelationshipCreateDrawer
        relatedListKey="Post"
        title="Post"
        fields={{ views: { type: 'bigInt' } }}
        parentId="u1"
        basePath="/admin"
        serverAction={drawerAction}
      />,
    )

    await user.click(screen.getByRole('button', { name: /add post/i }))
    const views = within(screen.getByRole('dialog')).getByLabelText(/^Views/)
    await user.type(views, '1e9')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' }))

    expect(drawerAction).not.toHaveBeenCalled()
    expect(views).toHaveFocus()

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: /add post/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create' }))

    expect(drawerAction).toHaveBeenCalledTimes(1)
  })

  it('blocks the standalone create form', async () => {
    const onSubmit = vi.fn(async () => ({ success: true }))
    const user = userEvent.setup()
    render(
      <ItemCreateForm fields={projectFieldConfigs({ price: decimal() })} onSubmit={onSubmit} />,
    )

    const price = screen.getByLabelText(/^Price/)
    await user.type(price, '9.9x')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(price).toHaveFocus()
  })

  it('blocks the standalone edit form without taking its unchanged path', async () => {
    const onSubmit = vi.fn(async () => ({ success: true }))
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <ItemEditForm
        fields={projectFieldConfigs({ meta: json(), title: text(), secret: password() })}
        initialData={{ meta: { keep: true }, title: 'Hi', secret: { isSet: true } }}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    )

    const meta = await replaceText(user, /^Meta/, '{"keep":')
    await user.click(save())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(meta).toHaveFocus()
  })
})

describe('a third-party field', () => {
  function Rating({ name, label }: { name: string; label: string }) {
    const ref = React.useRef<HTMLInputElement>(null)
    const [draft, setDraft] = React.useState('')
    useFieldValidity(name, draft !== '' && Number.isNaN(Number(draft)), ref)
    return (
      <label>
        {label}
        <input ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
    )
  }

  interface LegacyProps {
    name: string
    value: string
    onChange: (value: string) => void
    label: string
  }

  function Legacy({ name, value, onChange, label }: LegacyProps) {
    return (
      <label>
        {label}
        <input name={name} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    )
  }

  it('reports through useFieldValidity and is refused and focused like a built-in', async () => {
    const user = userEvent.setup()
    render(
      <ItemFormClient
        {...editProps({ fields: { rating: { type: 'text', ui: { component: Rating } } } })}
      />,
    )

    const rating = screen.getByLabelText(/Rating/)
    await user.type(rating, 'abc')
    await user.click(save())

    expect(mockPush).not.toHaveBeenCalled()
    expect(rating).toHaveFocus()
  })

  it('stays refused while either of two inputs under one name is invalid', async () => {
    function Range({ name, label }: { name: string; label: string }) {
      const fromRef = React.useRef<HTMLInputElement>(null)
      const toRef = React.useRef<HTMLInputElement>(null)
      const [from, setFrom] = React.useState('')
      const [to, setTo] = React.useState('')
      useFieldValidity(name, Number.isNaN(Number(from)), fromRef)
      useFieldValidity(name, Number.isNaN(Number(to)), toRef)
      return (
        <>
          <input
            ref={fromRef}
            aria-label={`${label} from`}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            ref={toRef}
            aria-label={`${label} to`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </>
      )
    }

    const user = userEvent.setup()
    render(
      <ItemFormClient
        {...editProps({ fields: { span: { type: 'text', ui: { component: Range } } } })}
      />,
    )

    const from = screen.getByLabelText('Span from')
    const to = screen.getByLabelText('Span to')
    await user.type(from, 'a')
    await user.type(to, 'b')
    await user.clear(to)
    await user.click(save())

    expect(mockPush).not.toHaveBeenCalled()
    expect(from).toHaveFocus()

    await user.clear(from)
    await user.click(save())

    expect(mockPush).toHaveBeenCalledWith('/admin/post')
  })

  it('keeps working unchanged when it never reports', async () => {
    const user = userEvent.setup()
    render(
      <ItemFormClient
        {...editProps({
          fields: { nickname: { type: 'text', ui: { component: Legacy } } },
          initialData: { nickname: 'a' },
        })}
      />,
    )

    await user.type(screen.getByLabelText(/Nickname/), 'b')
    await user.click(save())

    expect(serverAction).toHaveBeenCalledWith(expect.objectContaining({ data: { nickname: 'ab' } }))
  })
})
