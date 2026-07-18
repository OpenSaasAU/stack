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
