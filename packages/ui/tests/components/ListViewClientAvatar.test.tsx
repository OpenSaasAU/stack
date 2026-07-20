import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ListViewClient } from '../../src/components/ListViewClient.js'
import type { CellComponentProps } from '../../src/components/cells/registry.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/user',
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const baseProps = {
  items: [
    { id: '1', name: 'Ada Lovelace', role: 'admin' },
    { id: '2', name: 'Grace Hopper', role: 'user' },
  ],
  fieldTypes: { name: 'text', role: 'text' },
  relationshipRefs: {},
  listKey: 'User',
  urlKey: 'user',
  basePath: '/admin',
  page: 1,
  pageSize: 50,
  total: 2,
}

/**
 * The label column of an avatar-opted-in list renders through the AvatarLabelCell
 * (issue #735); a per-field cell override on that field still wins.
 */
describe('ListViewClient avatar column', () => {
  it('renders the avatar label Cell for the configured avatar column', () => {
    const { container } = render(<ListViewClient {...baseProps} avatarColumn="name" />)

    // Both label rows render as avatar cells with their deterministic initials.
    const cells = container.querySelectorAll('[data-slot="cell-avatar-label"]')
    expect(cells).toHaveLength(2)
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    const avatars = container.querySelectorAll('[data-slot="avatar"]')
    expect(avatars[0]).toHaveTextContent('AL')
  })

  it('does not render avatar cells when no avatarColumn is set (default text-only)', () => {
    const { container } = render(<ListViewClient {...baseProps} />)
    expect(container.querySelector('[data-slot="cell-avatar-label"]')).toBeNull()
  })

  it('does not apply the avatar to a non-label column', () => {
    const { container } = render(<ListViewClient {...baseProps} avatarColumn="name" />)
    // The `role` column cells are plain text, not avatar cells.
    const roleCell = screen.getByText('admin')
    expect(roleCell.closest('[data-slot="cell-avatar-label"]')).toBeNull()
    // Exactly the two label cells are avatars.
    expect(container.querySelectorAll('[data-slot="cell-avatar-label"]')).toHaveLength(2)
  })

  it('lets a per-field cell override win over the avatar treatment', () => {
    function OverrideCell({ value }: CellComponentProps) {
      return <span data-slot="cell-override">override:{String(value)}</span>
    }
    const fields: Record<string, SerializableFieldConfig> = {
      name: { type: 'text', ui: { cell: OverrideCell } },
      role: { type: 'text' },
    }
    const { container } = render(
      <ListViewClient {...baseProps} fields={fields} avatarColumn="name" />,
    )

    // The override renders; the avatar treatment is suppressed for that column.
    expect(container.querySelector('[data-slot="cell-avatar-label"]')).toBeNull()
    expect(screen.getByText('override:Ada Lovelace')).toBeInTheDocument()
  })
})
