import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldRenderer } from '../../src/components/fields/FieldRenderer.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

/**
 * FieldRenderer wires the field config's help/description text through to the
 * rendered field component (issue #721). A field author sets `ui.description`
 * in their `opensaas.config.ts`; FieldRenderer surfaces it as the component's
 * `helpText`, which renders via the shared field-shell `FieldHelp`
 * (data-slot="field-help"). Assertions are on external behaviour only — the
 * rendered help text and its `data-slot` — not internal structure.
 */
const findHelp = (container: HTMLElement): Element | null =>
  container.querySelector('[data-slot="field-help"]')

describe('FieldRenderer helpText wiring', () => {
  it('renders ui.description as help text via the field shell', () => {
    const fieldConfig: SerializableFieldConfig = {
      type: 'text',
      label: 'Slug',
      ui: { description: 'URL-friendly identifier, lowercase only.' },
    }

    const { container } = render(
      <FieldRenderer fieldName="slug" fieldConfig={fieldConfig} value="" onChange={vi.fn()} />,
    )

    const help = findHelp(container)
    expect(help).not.toBeNull()
    expect(help).toHaveTextContent('URL-friendly identifier, lowercase only.')
    expect(screen.getByText('URL-friendly identifier, lowercase only.')).toBeInTheDocument()
  })

  it('renders no help text when the field config has no description', () => {
    const fieldConfig: SerializableFieldConfig = {
      type: 'text',
      label: 'Slug',
    }

    const { container } = render(
      <FieldRenderer fieldName="slug" fieldConfig={fieldConfig} value="" onChange={vi.fn()} />,
    )

    expect(findHelp(container)).toBeNull()
  })
})

/**
 * A `virtual` field is computed and unwritable. Before issue #821 there was no
 * registry entry for `virtual`, so `FieldRenderer` fell through to the
 * "Unsupported field type" placeholder in both read and edit mode, and the
 * edit form offered an (unusable) editable control for it.
 */
describe('FieldRenderer virtual fields', () => {
  const fieldConfig: SerializableFieldConfig = {
    type: 'virtual',
    label: 'Full Name',
    virtual: true,
  }

  it('renders the resolved value and label in read mode without the unsupported-type placeholder', () => {
    render(
      <FieldRenderer
        fieldName="fullName"
        fieldConfig={fieldConfig}
        value="Ada Lovelace"
        onChange={vi.fn()}
        mode="read"
      />,
    )

    expect(screen.getByText('Full Name')).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByText(/Unsupported field type/)).not.toBeInTheDocument()
  })

  it('does not warn about a missing registered component', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <FieldRenderer
        fieldName="fullName"
        fieldConfig={fieldConfig}
        value="Ada Lovelace"
        onChange={vi.fn()}
        mode="read"
      />,
    )

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('renders read-only (no editable input) even when asked for edit mode', () => {
    render(
      <FieldRenderer
        fieldName="fullName"
        fieldConfig={fieldConfig}
        value="Ada Lovelace"
        onChange={vi.fn()}
        mode="edit"
      />,
    )

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('lets a per-field ui.component override still take priority over the default virtual renderer', () => {
    function CustomVirtual({ value }: { value: unknown }) {
      return <div data-testid="custom-virtual">custom: {String(value)}</div>
    }

    render(
      <FieldRenderer
        fieldName="fullName"
        fieldConfig={{ ...fieldConfig, ui: { component: CustomVirtual } }}
        value="Ada Lovelace"
        onChange={vi.fn()}
        mode="read"
      />,
    )

    expect(screen.getByTestId('custom-virtual')).toHaveTextContent('custom: Ada Lovelace')
  })
})
