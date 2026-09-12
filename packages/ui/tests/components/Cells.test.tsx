import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SelectCell } from '../../src/components/cells/SelectCell.js'
import { IntegerCell } from '../../src/components/cells/IntegerCell.js'
import { TimestampCell } from '../../src/components/cells/TimestampCell.js'
import { CheckboxCell } from '../../src/components/cells/CheckboxCell.js'
import { RelationshipCell } from '../../src/components/cells/RelationshipCell.js'
import { TextCell } from '../../src/components/cells/TextCell.js'
import { PasswordCell } from '../../src/components/cells/PasswordCell.js'
import { JsonCell } from '../../src/components/cells/JsonCell.js'
import { getCellComponent } from '../../src/components/cells/registry.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

const statusField: SerializableFieldConfig = {
  type: 'select',
  options: [
    { label: 'Draft', value: 'draft', ui: { variant: 'secondary' } },
    { label: 'Published', value: 'published', ui: { variant: 'success' } },
    // No `ui.variant` — must fall back to the neutral badge.
    { label: 'Archived', value: 'archived' },
  ],
}

describe('SelectCell', () => {
  it('colours the badge from the matched option ui.variant', () => {
    render(<SelectCell value="published" field={statusField} fieldName="status" />)
    const badge = screen.getByText('Published')
    expect(badge).toHaveAttribute('data-slot', 'cell-select')
    // `success` variant maps to the success token class.
    expect(badge.className).toContain('text-success')
  })

  it('renders the neutral badge for an option without variant metadata', () => {
    render(<SelectCell value="archived" field={statusField} fieldName="status" />)
    const badge = screen.getByText('Archived')
    // Neutral = secondary variant.
    expect(badge.className).toContain('bg-secondary')
    expect(badge.className).not.toContain('text-success')
  })

  it('renders the neutral badge for an unmapped value not in options', () => {
    render(<SelectCell value="mystery" field={statusField} fieldName="status" />)
    const badge = screen.getByText('mystery')
    expect(badge.className).toContain('bg-secondary')
  })

  it('renders a dash for an empty value', () => {
    render(<SelectCell value={null} field={statusField} fieldName="status" />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })
})

describe('IntegerCell', () => {
  it('renders numbers with tabular figures', () => {
    render(<IntegerCell value={42} field={{ type: 'integer' }} fieldName="views" />)
    const cell = screen.getByText('42')
    expect(cell).toHaveAttribute('data-slot', 'cell-integer')
    expect(cell.className).toContain('tabular-nums')
  })
})

describe('TimestampCell', () => {
  it('formats a valid timestamp', () => {
    render(
      <TimestampCell value="2024-01-01T12:00:00Z" field={{ type: 'timestamp' }} fieldName="at" />,
    )
    expect(screen.getByText(/2024/)).toBeInTheDocument()
  })

  it('renders a dash for an invalid/empty value', () => {
    render(<TimestampCell value={null} field={{ type: 'timestamp' }} fieldName="at" />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })
})

describe('CheckboxCell', () => {
  it('renders a mark with an accessible name for true/false', () => {
    const { rerender } = render(
      <CheckboxCell value={true} field={{ type: 'checkbox' }} fieldName="done" />,
    )
    expect(screen.getByLabelText('Yes')).toBeInTheDocument()

    rerender(<CheckboxCell value={false} field={{ type: 'checkbox' }} fieldName="done" />)
    expect(screen.getByLabelText('No')).toBeInTheDocument()
  })
})

describe('RelationshipCell', () => {
  const field: SerializableFieldConfig = { type: 'relationship', ref: 'User.posts' }

  it('renders a to-one relationship as a linked Item label', () => {
    render(
      <RelationshipCell
        value={{ id: 'user-1', label: 'Ada Lovelace' }}
        field={field}
        fieldName="author"
        basePath="/admin"
      />,
    )
    const link = screen.getByRole('link', { name: 'Ada Lovelace' })
    expect(link).toHaveAttribute('href', '/admin/user/user-1')
  })

  it('falls back to a raw record label when not pre-resolved', () => {
    render(
      <RelationshipCell
        value={{ id: 'user-2', name: 'Grace Hopper' }}
        field={field}
        fieldName="author"
        basePath="/admin"
      />,
    )
    expect(screen.getByRole('link', { name: 'Grace Hopper' })).toBeInTheDocument()
  })

  it('renders a dash for an empty relationship', () => {
    render(<RelationshipCell value={null} field={field} fieldName="author" />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  // A to-one relation reads as nullable by arity, not by column (ADR-0058), so
  // `null` is the ordinary answer for a related row the session may not see —
  // not a shape the table may crash on.
  it('renders an unreadable related row without error (ADR-0058)', () => {
    const manyField: SerializableFieldConfig = {
      type: 'relationship',
      ref: 'Post.author',
      many: true,
    }

    const { container, rerender } = render(
      <RelationshipCell value={undefined} field={field} fieldName="author" basePath="/admin" />,
    )
    expect(screen.getByText('-')).toBeInTheDocument()

    // A row that came back with no readable label field is rendered unlinked
    // rather than as a link to nowhere.
    rerender(
      <RelationshipCell
        value={{ id: 'user-3' }}
        field={field}
        fieldName="author"
        basePath="/admin"
      />,
    )
    expect(screen.getByRole('link', { name: 'user-3' })).toBeInTheDocument()

    // A to-many that resolved to nothing counts as zero.
    rerender(<RelationshipCell value={null} field={manyField} fieldName="posts" />)
    expect(container.querySelector('[data-slot="cell-relationship-count"]')).toHaveTextContent('0')
  })

  it('renders a to-many relationship as its access-visible count (issue #732)', () => {
    const manyField: SerializableFieldConfig = {
      type: 'relationship',
      ref: 'Post.author',
      many: true,
    }
    const { container, rerender } = render(
      <RelationshipCell value={4} field={manyField} fieldName="posts" />,
    )
    const cell = container.querySelector('[data-slot="cell-relationship-count"]')
    expect(cell).toHaveTextContent('4')
    // No related-label links are rendered for a count column.
    expect(screen.queryByRole('link')).toBeNull()

    // A zero count still renders (a closed related list shows 0, not a leak).
    rerender(<RelationshipCell value={0} field={manyField} fieldName="posts" />)
    expect(container.querySelector('[data-slot="cell-relationship-count"]')).toHaveTextContent('0')

    // Tolerates a resolved-refs array fallback by counting its length.
    rerender(
      <RelationshipCell
        value={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ]}
        field={manyField}
        fieldName="posts"
      />,
    )
    expect(container.querySelector('[data-slot="cell-relationship-count"]')).toHaveTextContent('2')
  })
})

describe('TextCell', () => {
  it('renders a dash for empty values', () => {
    render(<TextCell value="" field={{ type: 'text' }} fieldName="t" />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  // issue #1418: a field type with no registered Cell falls back to TextCell,
  // and `String(anObject)` reads as `[object Object]` — worse than an explicit
  // placeholder.
  it('renders an explicit placeholder for an object value instead of stringifying it', () => {
    render(<TextCell value={{ foo: 'bar' }} field={{ type: 'someUnknownType' }} fieldName="t" />)
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByText('Unsupported value')).toBeInTheDocument()
  })

  it('renders an explicit placeholder for an array value instead of stringifying it', () => {
    render(<TextCell value={[1, 2, 3]} field={{ type: 'someUnknownType' }} fieldName="t" />)
    expect(screen.getByText('Unsupported value')).toBeInTheDocument()
  })

  // A `virtual()` field can declare a custom class type (CLAUDE.md's own
  // `Decimal` example) with no registered Cell of its own. It must keep
  // rendering through its own `toString()` rather than being caught by the
  // plain-object/array placeholder above.
  it('renders a class instance with a custom toString via String(), not the placeholder', () => {
    class Money {
      constructor(private cents: number) {}
      toString() {
        return `$${(this.cents / 100).toFixed(2)}`
      }
    }
    render(<TextCell value={new Money(2340)} field={{ type: 'someUnknownType' }} fieldName="t" />)
    expect(screen.getByText('$23.40')).toBeInTheDocument()
    expect(screen.queryByText('Unsupported value')).not.toBeInTheDocument()
  })
})

describe('JsonCell', () => {
  it('is registered as the default Cell for the json field type', () => {
    expect(getCellComponent('json')).toBe(JsonCell)
  })

  it('renders a dash for an empty value', () => {
    render(<JsonCell value={null} field={{ type: 'json' }} fieldName="metadata" />)
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders a compact size summary for an object, never the raw payload', () => {
    render(<JsonCell value={{ a: 1, b: 2, c: 3 }} field={{ type: 'json' }} fieldName="metadata" />)
    const cell = screen.getByText('Object (3 keys)')
    expect(cell).toHaveAttribute('data-slot', 'cell-json')
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
  })

  it('renders a compact size summary for an array', () => {
    render(<JsonCell value={[1, 2]} field={{ type: 'json' }} fieldName="tags" />)
    expect(screen.getByText('Array (2 items)')).toBeInTheDocument()
  })

  it('singularises a one-item shape', () => {
    render(<JsonCell value={['x']} field={{ type: 'json' }} fieldName="tags" />)
    expect(screen.getByText('Array (1 item)')).toBeInTheDocument()

    render(<JsonCell value={{ a: 1 }} field={{ type: 'json' }} fieldName="metadata" />)
    expect(screen.getByText('Object (1 key)')).toBeInTheDocument()
  })

  it('renders a scalar JSON value directly', () => {
    render(<JsonCell value="hello" field={{ type: 'json' }} fieldName="note" />)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})

describe('PasswordCell', () => {
  it('renders a fixed mask regardless of the raw value', () => {
    render(<PasswordCell value="hunter2" field={{ type: 'password' }} fieldName="password" />)
    const cell = screen.getByText('••••••••')
    expect(cell).toHaveAttribute('data-slot', 'cell-password')
  })

  it('does not depend on any serialisation of value — an empty/null value still masks', () => {
    render(<PasswordCell value={null} field={{ type: 'password' }} fieldName="password" />)
    expect(screen.getByText('••••••••')).toBeInTheDocument()
  })
})
