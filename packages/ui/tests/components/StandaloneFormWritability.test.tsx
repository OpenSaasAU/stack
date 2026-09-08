import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OpenSaasConfig } from '@opensaas/stack-core'

import { ItemCreateForm } from '../../src/components/standalone/ItemCreateForm.js'
import { ItemEditForm } from '../../src/components/standalone/ItemEditForm.js'

/**
 * The standalone forms serialize their own field configs, so the marking
 * `serializeFieldConfig` makes from the field alone (a to-many) reaches them,
 * but the one that needs the whole config (the non-owning end of a one-to-one)
 * does not — unless they are given that config.
 *
 * `Profile.user` holds the column, so `User.profile` is the non-owning end and
 * a picker rendered for it would offer an edit the engine refuses at save.
 */
const config: OpenSaasConfig = {
  db: { provider: 'sqlite', url: 'file:./test.db' },
  lists: {
    User: {
      fields: { name: { type: 'text' }, profile: { type: 'relationship', ref: 'Profile.user' } },
    },
    Profile: {
      fields: { bio: { type: 'text' }, user: { type: 'relationship', ref: 'User.profile' } },
    },
  },
} as unknown as OpenSaasConfig

const noop = async () => ({ success: true })

describe('standalone ItemCreateForm relationship writability', () => {
  it('renders the non-owning end of a one-to-one read-only when given its list and config', () => {
    const { container } = render(
      <ItemCreateForm
        fields={config.lists.User.fields}
        listKey="User"
        config={config}
        relationshipData={{ profile: [{ id: 'p1', label: 'Ada' }] }}
        onSubmit={noop}
      />,
    )

    expect(screen.getByText(/Not editable here/)).toBeInTheDocument()
    expect(container.querySelector('[data-slot="combobox-trigger"]')).toBeNull()
  })

  it('leaves the foreign-key-owning end of the same edge editable', () => {
    const { container } = render(
      <ItemCreateForm
        fields={config.lists.Profile.fields}
        listKey="Profile"
        config={config}
        relationshipData={{ user: [{ id: 'u1', label: 'Ada' }] }}
        onSubmit={noop}
      />,
    )

    expect(screen.queryByText(/Not editable here/)).toBeNull()
    expect(container.querySelector('[data-slot="combobox-trigger"]')).not.toBeNull()
  })
})

describe('standalone ItemEditForm relationship writability', () => {
  it('renders the non-owning end of a one-to-one read-only when given its list and config', () => {
    const { container } = render(
      <ItemEditForm
        fields={config.lists.User.fields}
        listKey="User"
        config={config}
        initialData={{ id: 'u1', name: 'Ada' }}
        relationshipData={{ profile: [{ id: 'p1', label: 'Ada' }] }}
        onSubmit={noop}
      />,
    )

    expect(screen.getByText(/Not editable here/)).toBeInTheDocument()
    expect(container.querySelector('[data-slot="combobox-trigger"]')).toBeNull()
  })
})
