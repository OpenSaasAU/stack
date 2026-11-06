import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { select, text } from '@opensaas/stack-core/fields'
import { ItemFormClient, type ItemFormClientProps } from '../../../src/components/ItemFormClient.js'
import { RelationshipCreateDrawer } from '../../../src/components/RelationshipCreateDrawer.js'
import { ItemCreateForm } from '../../../src/components/standalone/ItemCreateForm.js'
import { ItemEditForm } from '../../../src/components/standalone/ItemEditForm.js'
import type { SerializableFieldConfig } from '../../../src/lib/serializeFieldConfig.js'

vi.mock('next/navigation.js', () => ({
  usePathname: () => '/admin',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('next/link.js', () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}))

vi.mock('next/image.js', () => ({ default: () => null }))

vi.mock('@opensaas/stack-core', () => ({
  getUrlKey: (listKey: string) => listKey,
  resolveJunctionEdge: () => null,
}))

const required = { validation: { isRequired: true } }
const status = {
  type: 'select',
  ...required,
  options: [
    { label: 'Draft', value: 'draft' },
    { label: 'Live', value: 'live' },
  ],
} satisfies SerializableFieldConfig

const serverAction = vi.fn(async () => ({ success: true, data: { id: 'p1' } }))

function createProps(fields: Record<string, SerializableFieldConfig>): ItemFormClientProps {
  return {
    listKey: 'Post',
    urlKey: 'post',
    mode: 'create',
    fields,
    basePath: '/admin',
    serverAction,
  }
}

const submit = (name = 'Create') => userEvent.click(screen.getByRole('button', { name }))

/** The control with focus must be the one announcing the error, and be a real one. */
async function expectFocusOnError(name: RegExp, message: string | RegExp) {
  const control = await waitFor(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active.getAttribute('aria-invalid') !== 'true') {
      throw new Error(`Focus is on ${active?.outerHTML.slice(0, 120)}`)
    }
    return active
  })
  expect(control).toHaveAccessibleName(name)
  expect(control).toHaveAccessibleDescription(message)
  expect(control.getAttribute('aria-hidden')).toBeNull()
  expect(control.tabIndex).toBeGreaterThanOrEqual(0)
}

afterEach(cleanup)
beforeEach(() => serverAction.mockClear())

describe('a required select left empty', () => {
  it('focuses its trigger, not the hidden select, with the message tied to it', async () => {
    render(<ItemFormClient {...createProps({ status })} />)

    await submit()

    await expectFocusOnError(/Status/, 'Status is required')
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('clears the error once a value is chosen, and then submits it', async () => {
    render(<ItemFormClient {...createProps({ status })} />)
    await submit()
    await expectFocusOnError(/Status/, 'Status is required')

    await userEvent.keyboard('{Enter}')
    await userEvent.click(await screen.findByRole('option', { name: 'Live' }))
    await waitFor(() => expect(screen.queryByText('Status is required')).toBeNull())
    await submit()

    await waitFor(() =>
      expect(serverAction).toHaveBeenCalledWith({
        listKey: 'Post',
        action: 'create',
        data: { status: 'live' },
      }),
    )
  })

  it('still refuses on edit when the row loaded without a value and nothing changed', async () => {
    render(
      <ItemFormClient
        {...createProps({ status, title: { type: 'text' } })}
        mode="edit"
        itemId="p1"
        initialData={{ status: null, title: 'Hello' }}
      />,
    )

    await submit('Save')

    await expectFocusOnError(/Status/, 'Status is required')
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('is refused the same way on a singleton, which has no delete', async () => {
    render(
      <ItemFormClient
        {...createProps({ status })}
        mode="edit"
        itemId="1"
        canDelete={false}
        initialData={{ status: null }}
      />,
    )

    await submit('Save')

    await expectFocusOnError(/Status/, 'Status is required')
  })
})

describe('the first error wins, whichever check found it', () => {
  it('focuses a bad decimal declared before an empty required select', async () => {
    render(<ItemFormClient {...createProps({ price: { type: 'decimal' }, status })} />)

    await userEvent.type(screen.getByLabelText('Price'), 'abc')
    await submit()

    await expectFocusOnError(/Price/, 'Price must be a decimal value')
    expect(screen.getByText('Status is required')).toBeInTheDocument()
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('focuses an empty required select declared before a bad decimal', async () => {
    render(<ItemFormClient {...createProps({ status, price: { type: 'decimal' } })} />)

    await userEvent.type(screen.getByLabelText('Price'), 'abc')
    await submit()

    await expectFocusOnError(/Status/, 'Status is required')
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('marks every refused field in one pass', async () => {
    render(
      <ItemFormClient
        {...createProps({
          title: { type: 'text', ...required },
          views: { type: 'integer', ...required },
          price: { type: 'decimal', ...required },
          meta: { type: 'json', ...required },
          status,
        })}
      />,
    )

    await submit()

    await expectFocusOnError(/Title/, 'Title is required')
    for (const message of [
      'Views is required',
      'Price is required',
      'Meta is required',
      'Status is required',
    ]) {
      expect(screen.getByText(message)).toBeInTheDocument()
    }
    expect(serverAction).not.toHaveBeenCalled()
  })
})

describe('what the browser used to refuse on its own', () => {
  it('refuses a required password with both boxes empty', async () => {
    render(<ItemFormClient {...createProps({ secret: { type: 'password', ...required } })} />)

    await submit()

    await expectFocusOnError(/^Secret/, 'Secret is required')
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('leaves an unconfirmed password to its own check, in the confirm box', async () => {
    render(<ItemFormClient {...createProps({ secret: { type: 'password', ...required } })} />)

    await userEvent.type(screen.getByLabelText(/^Secret/), 'hunter22')
    await submit()

    await expectFocusOnError(/Confirm Secret/, 'Re-enter secret to confirm')
    expect(screen.queryByText('Secret is required')).toBeNull()
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('refuses text a number input cannot parse, even on an optional field', async () => {
    render(<ItemFormClient {...createProps({ views: { type: 'integer' } })} />)

    await userEvent.type(screen.getByLabelText('Views'), '1e')
    await submit()

    await expectFocusOnError(/Views/, /number/i)
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('refuses a number outside the range its ui options set', async () => {
    render(
      <ItemFormClient {...createProps({ views: { type: 'integer', ui: { min: 1, max: 5 } } })} />,
    )

    await userEvent.type(screen.getByLabelText('Views'), '9')
    await submit()

    await expectFocusOnError(/Views/, /5/)
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('keeps refusing a third-party control that declares its own constraint', async () => {
    function NativeEmailField({
      id,
      name,
      value,
      onChange,
      error,
    }: {
      id: string
      name: string
      value?: string
      onChange: (value: string) => void
      error?: string
    }) {
      return (
        <>
          <label htmlFor={id}>Contact</label>
          <input
            id={id}
            name={name}
            type="email"
            required
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          {error && <p id={`${id}-error`}>{error}</p>}
        </>
      )
    }
    render(
      <ItemFormClient
        {...createProps({ contact: { type: 'text', ui: { component: NativeEmailField } } })}
      />,
    )

    await userEvent.type(screen.getByLabelText('Contact'), 'not-an-email')
    await submit()

    await expectFocusOnError(/Contact/, /@/)
    expect(serverAction).not.toHaveBeenCalled()
  })
})

describe('a control the browser may not focus', () => {
  it('is passed over for the visible one, even when neither says it is invalid', async () => {
    function HiddenRequiredField({ id, error }: { id: string; error?: string }) {
      return (
        <>
          <select aria-hidden="true" tabIndex={-1} required defaultValue="">
            <option value="">None</option>
            <option value="a">A</option>
          </select>
          <button id={id} type="button" role="combobox" aria-expanded={false} aria-label="Pick">
            Pick
          </button>
          {error && <p>{error}</p>}
        </>
      )
    }
    render(
      <ItemFormClient
        {...createProps({ pick: { type: 'text', ui: { component: HiddenRequiredField } } })}
      />,
    )

    await submit()

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Pick' })).toHaveFocus())
    expect(screen.getByText('Pick is required')).toBeInTheDocument()
    expect(serverAction).not.toHaveBeenCalled()
  })
})

describe('an optional field left empty', () => {
  it('submits, because nothing declared a constraint', async () => {
    render(
      <ItemFormClient
        {...createProps({
          title: { type: 'text' },
          views: { type: 'integer' },
          status: { ...status, validation: undefined },
        })}
      />,
    )

    await submit()

    await waitFor(() => expect(serverAction).toHaveBeenCalledTimes(1))
  })
})

describe('every form that submits', () => {
  it('lands on the error inside the relationship drawer', async () => {
    render(
      <RelationshipCreateDrawer
        relatedListKey="Post"
        title="Post"
        fields={{ status }}
        backReferenceField="author"
        parentId="u1"
        basePath="/admin"
        serverAction={serverAction}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '+ Add Post' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add Post' })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await expectFocusOnError(/Status/, 'Status is required')
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('lands on the error in the standalone create form', async () => {
    const onSubmit = vi.fn(async () => ({ success: true }))
    render(
      <ItemCreateForm
        fields={{
          title: text(),
          status: select({
            options: status.options,
            validation: { isRequired: true },
          }),
        }}
        onSubmit={onSubmit}
      />,
    )

    await submit()

    await expectFocusOnError(/Status/, 'Status is required')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('lands on the error in the standalone edit form', async () => {
    const onSubmit = vi.fn(async () => ({ success: true }))
    render(
      <ItemEditForm
        fields={{ title: text({ validation: { isRequired: true } }) }}
        initialData={{ title: '' }}
        onSubmit={onSubmit}
      />,
    )

    await submit('Save')

    await expectFocusOnError(/Title/, 'Title is required')
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
