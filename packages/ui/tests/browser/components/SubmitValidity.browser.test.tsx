import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { select, text } from '@opensaas/stack-core/fields'
import { ItemFormClient, type ItemFormClientProps } from '../../../src/components/ItemFormClient.js'
import { RelationshipCreateDrawer } from '../../../src/components/RelationshipCreateDrawer.js'
import { ItemCreateForm } from '../../../src/components/standalone/ItemCreateForm.js'
import { ItemEditForm } from '../../../src/components/standalone/ItemEditForm.js'
import { Dialog, DialogContent, DialogTitle } from '../../../src/primitives/dialog.js'
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

const serverAction = vi.fn(async (): Promise<unknown> => ({ success: true, data: { id: 'p1' } }))

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

describe('a form portalled out of a field', () => {
  const nestedAction = vi.fn(async () => ({ created: true, item: { id: 'n1' } }))
  beforeEach(() => nestedAction.mockClear())

  function DrawerField() {
    return (
      <RelationshipCreateDrawer
        relatedListKey="Tag"
        title="Tag"
        fields={{ name: { type: 'text', ...required } }}
        backReferenceField="post"
        parentId="p1"
        basePath="/admin"
        serverAction={nestedAction}
      />
    )
  }

  const openDrawer = async () => {
    render(
      <ItemFormClient
        {...createProps({ tags: { type: 'text', ui: { component: DrawerField } } })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '+ Add Tag' }))
    return screen.findByRole('dialog', { name: 'Add Tag' })
  }

  it('does not submit the form around it when it is refused', async () => {
    const dialog = await openDrawer()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await expectFocusOnError(/Name/, 'Name is required')
    expect(nestedAction).not.toHaveBeenCalled()
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('does not submit the form around it when it is valid', async () => {
    const dialog = await openDrawer()

    await userEvent.type(within(dialog).getByLabelText(/Name/), 'News')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(nestedAction).toHaveBeenCalledTimes(1))
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('does not mark the required fields of the form around it', async () => {
    const onSubmit = vi.fn(async () => ({ success: true }))
    function DialogField() {
      return (
        <Dialog open>
          <DialogContent>
            <DialogTitle>Nested</DialogTitle>
            <ItemCreateForm
              fields={{ name: text({ validation: { isRequired: true } }) }}
              onSubmit={onSubmit}
              submitLabel="Add"
            />
          </DialogContent>
        </Dialog>
      )
    }
    render(
      <ItemFormClient
        {...createProps({
          title: { type: 'text', ...required },
          nested: { type: 'text', ui: { component: DialogField } },
        })}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('Name is required')).toBeInTheDocument())
    expect(screen.queryByText('Title is required')).toBeNull()
    expect(serverAction).not.toHaveBeenCalled()
  })
})

describe('a field shows the one error that is still true', () => {
  it('drops "required" from a decimal once it holds text that does not parse', async () => {
    render(<ItemFormClient {...createProps({ price: { type: 'decimal', ...required } })} />)
    await submit()
    await expectFocusOnError(/Price/, 'Price is required')

    await userEvent.type(screen.getByLabelText(/Price/), 'abc')
    await waitFor(() => expect(screen.queryByText(/is required/)).toBeNull())
    await submit()

    await expectFocusOnError(/Price/, 'Price must be a decimal value')
  })

  it('drops "required" from JSON once it holds text that does not parse', async () => {
    render(<ItemFormClient {...createProps({ data: { type: 'json', ...required } })} />)
    await submit()
    await expectFocusOnError(/Data/, 'Data is required')

    await userEvent.click(screen.getByLabelText(/Data/))
    await userEvent.keyboard('nope')
    await submit()

    await waitFor(() => expect(screen.getByLabelText(/Data/)).toHaveFocus())
    expect(screen.queryByText(/is required/)).toBeNull()
  })

  it('drops a server error when the field turns unparseable without calling onChange', async () => {
    serverAction.mockResolvedValueOnce({
      success: false,
      error: 'Validation failed',
      fieldErrors: { price: 'Price is too high' },
    })
    render(<ItemFormClient {...createProps({ price: { type: 'decimal' } })} />)
    await userEvent.type(screen.getByLabelText('Price'), '9')
    await submit()
    await expectFocusOnError(/Price/, 'Price is too high')

    await userEvent.type(screen.getByLabelText('Price'), 'x')

    await waitFor(() => expect(screen.queryByText('Price is too high')).toBeNull())
    expect(screen.getByText('Price must be a decimal value')).toBeInTheDocument()
  })

  it('moves on from a number whose bad text was deleted, to what still blocks', async () => {
    render(
      <ItemFormClient
        {...createProps({ views: { type: 'integer' }, title: { type: 'text', ...required } })}
      />,
    )
    await userEvent.type(screen.getByLabelText('Views'), 'e')
    await submit()
    await expectFocusOnError(/Views/, /number/i)

    await userEvent.click(screen.getByLabelText('Views'))
    await userEvent.keyboard('{Backspace}')
    await submit()

    await expectFocusOnError(/Title/, 'Title is required')
    expect(screen.getByLabelText('Views')).not.toHaveAttribute('aria-invalid')
  })

  it('keeps a server error the user has not answered when another field is refused', async () => {
    serverAction.mockResolvedValueOnce({
      success: false,
      error: 'Validation failed',
      fieldErrors: { slug: 'Slug is taken' },
    })
    render(
      <ItemFormClient
        {...createProps({ slug: { type: 'text' }, title: { type: 'text', ...required } })}
      />,
    )
    await userEvent.type(screen.getByLabelText(/Title/), 'Hello')
    await submit()
    await expectFocusOnError(/Slug/, 'Slug is taken')

    await userEvent.clear(screen.getByLabelText(/Title/))
    await submit()

    await waitFor(() => expect(screen.getByText('Title is required')).toBeInTheDocument())
    expect(screen.getByText('Slug is taken')).toBeInTheDocument()
    expect(serverAction).toHaveBeenCalledTimes(1)
  })
})

describe('the message names what is wrong', () => {
  it('says a required number holding unparseable text is not a number', async () => {
    render(<ItemFormClient {...createProps({ qty: { type: 'integer', ...required } })} />)

    await userEvent.type(screen.getByLabelText(/Qty/), '1e')
    await submit()

    await expectFocusOnError(/Qty/, /number/i)
    expect(screen.queryByText('Qty is required')).toBeNull()
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('uses the label the field shows, ui.label first', async () => {
    render(
      <ItemFormClient
        {...createProps({
          b: { type: 'text', label: 'Config Label', ui: { label: 'UI Label' }, ...required },
          c: { type: 'text', label: 'Config Label', ...required },
        })}
      />,
    )

    await submit()

    await expectFocusOnError(/UI Label/, 'UI Label is required')
    expect(screen.getByText('Config Label is required')).toBeInTheDocument()
  })

  it('refuses a required field whose name is on Object.prototype', async () => {
    render(<ItemFormClient {...createProps({ constructor: { type: 'text', ...required } })} />)

    await submit()

    await expectFocusOnError(/Constructor/, 'Constructor is required')
    expect(serverAction).not.toHaveBeenCalled()
  })
})

describe('an optional field whose name is on Object.prototype', () => {
  it('has no error until it is given one', async () => {
    render(<ItemFormClient {...createProps({ constructor: { type: 'text' } })} />)

    expect(screen.getByLabelText('Constructor')).not.toHaveAttribute('aria-invalid')
  })
})

describe('a field with more than one input', () => {
  function TwoInputs({ id, error, both }: { id: string; error?: string; both?: boolean }) {
    return (
      <>
        <input aria-label="First" required={both} />
        <input aria-label="Second" id={id} required />
        {error && <p>{error}</p>}
      </>
    )
  }

  it('focuses the input that was refused, not the first', async () => {
    render(
      <ItemFormClient {...createProps({ pair: { type: 'text', ui: { component: TwoInputs } } })} />,
    )

    await submit()

    await waitFor(() => expect(screen.getByLabelText('Second')).toHaveFocus())
  })

  it('focuses the first refused input when two are', async () => {
    render(
      <ItemFormClient
        {...createProps({ pair: { type: 'text', ui: { component: TwoInputs, both: true } } })}
      />,
    )

    await submit()

    await waitFor(() => expect(screen.getByLabelText('First')).toHaveFocus())
  })
})

describe('a third-party control', () => {
  function SilentField({
    id,
    value,
    onChange,
  }: {
    id: string
    value?: string
    onChange: (value: string) => void
  }) {
    return (
      <>
        <label htmlFor={id}>Nickname</label>
        <input
          id={id}
          type="email"
          required
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      </>
    )
  }

  const props = createProps({ nickname: { type: 'text', ui: { component: SilentField } } })

  it('still explains a refusal in the banner when it ignores `error`', async () => {
    render(<ItemFormClient {...props} />)

    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Nickname is required')
    expect(screen.getByLabelText('Nickname')).toHaveFocus()
    expect(serverAction).not.toHaveBeenCalled()
  })

  it('names the field when the browser message does not', async () => {
    render(<ItemFormClient {...props} />)

    await userEvent.type(screen.getByLabelText('Nickname'), 'x')
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Nickname: .*@/)
  })

  it('takes the banner away once the field changes', async () => {
    render(<ItemFormClient {...props} />)
    await submit()
    await screen.findByRole('alert')

    await userEvent.type(screen.getByLabelText('Nickname'), 'a')

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('leaves the banner out when the field shows the message itself', async () => {
    render(<ItemFormClient {...createProps({ title: { type: 'text', ...required } })} />)

    await submit()

    await expectFocusOnError(/Title/, 'Title is required')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is not refused while disabled, as the browser would not refuse it', async () => {
    function DisabledField({ id }: { id: string }) {
      return <input id={id} aria-label="Locked" type="number" max={5} defaultValue={9} disabled />
    }
    render(
      <ItemFormClient
        {...createProps({ locked: { type: 'text', ui: { component: DisabledField } } })}
      />,
    )

    await submit()

    await waitFor(() => expect(serverAction).toHaveBeenCalledTimes(1))
  })
})
