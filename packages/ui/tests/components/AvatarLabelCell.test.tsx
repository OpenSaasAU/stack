import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AvatarLabelCell } from '../../src/components/cells/AvatarLabelCell.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

const textField: SerializableFieldConfig = { type: 'text' }

/**
 * The avatar label Cell (issue #735) renders an initials bubble ahead of the
 * emphasized Item label, and degrades to a neutral bubble + muted dash when the
 * label is empty.
 */
describe('AvatarLabelCell', () => {
  it('renders an initials avatar ahead of the emphasized label', () => {
    const { container } = render(
      <AvatarLabelCell value="Ada Lovelace" field={textField} fieldName="name" />,
    )

    const cell = container.querySelector('[data-slot="cell-avatar-label"]')
    expect(cell).toBeInTheDocument()

    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar).toHaveTextContent('AL')

    // The label text is emphasized (font-medium), matching the mock.
    const label = screen.getByText('Ada Lovelace')
    expect(label).toHaveClass('font-medium')
  })

  it('renders the avatar as decorative so the cell accessible name is only the label', () => {
    const { container } = render(
      <AvatarLabelCell value="Ada Lovelace" field={textField} fieldName="name" />,
    )

    // The avatar contributes nothing to the accessible name: it is aria-hidden
    // and carries no img role / aria-label. The label text beside it is the name.
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar).not.toHaveAttribute('role')
    expect(avatar).not.toHaveAttribute('aria-label')
  })

  it('degrades to a neutral bubble and a muted dash for an empty value', () => {
    const { container } = render(<AvatarLabelCell value="" field={textField} fieldName="name" />)

    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar).toHaveTextContent('?')

    expect(screen.getByText('-')).toHaveClass('text-muted-foreground')
  })
})
