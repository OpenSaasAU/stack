import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { integer, relationship, text } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'

import { ItemCreateForm } from '../../src/components/standalone/ItemCreateForm.js'
import { ItemEditForm } from '../../src/components/standalone/ItemEditForm.js'
import { serializeFieldConfigs } from '../../src/server/index.js'

const BOOT = 120_000

const openOperations = {
  query: () => true,
  create: () => true,
  update: () => true,
}

/**
 * `Profile.user` holds the column, so `User.profile` is the non-owning end and
 * a picker rendered for it would offer an edit the engine refuses at save.
 */
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      User: {
        fields: { name: text(), profile: relationship({ ref: 'Profile.user' }) },
        access: { operation: openOperations },
      },
      Profile: {
        fields: { bio: text(), user: relationship({ ref: 'User.profile' }) },
        access: { operation: openOperations },
      },
      Doc: {
        fields: {
          title: text(),
          score: integer({ access: { create: () => false, update: () => false } }),
          secret: text({ access: { read: () => false, create: () => false, update: () => false } }),
        },
        access: { operation: openOperations },
      },
    },
  }
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(makeConfig())
}, BOOT)

afterAll(async () => {
  await database?.close()
})

const noop = async () => ({ success: true })

describe('standalone ItemCreateForm', () => {
  it('renders the non-owning end of a one-to-one read-only', async () => {
    const fields = await serializeFieldConfigs(database.context(null), 'User', 'create')
    const { container } = render(
      <ItemCreateForm
        fields={fields}
        relationshipData={{ profile: [{ id: 'p1', label: 'Ada' }] }}
        onSubmit={noop}
      />,
    )

    expect(screen.getByText(/Not editable here/)).toBeInTheDocument()
    expect(container.querySelector('[data-slot="combobox-trigger"]')).toBeNull()
  })

  it('leaves the foreign-key-owning end of the same edge editable', async () => {
    const fields = await serializeFieldConfigs(database.context(null), 'Profile', 'create')
    const { container } = render(
      <ItemCreateForm
        fields={fields}
        relationshipData={{ user: [{ id: 'u1', label: 'Ada' }] }}
        onSubmit={noop}
      />,
    )

    expect(screen.queryByText(/Not editable here/)).toBeNull()
    expect(container.querySelector('[data-slot="combobox-trigger"]')).not.toBeNull()
  })

  it('marks a write-denied field read-only and renders no never-readable field', async () => {
    const fields = await serializeFieldConfigs(database.context(null), 'Doc', 'create')
    render(<ItemCreateForm fields={fields} onSubmit={noop} />)

    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Score' })).not.toBeInTheDocument()
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
  })
})

describe('standalone ItemEditForm', () => {
  it('renders the non-owning end of a one-to-one read-only', async () => {
    const fields = await serializeFieldConfigs(database.context(null), 'User', 'update')
    const { container } = render(
      <ItemEditForm
        fields={fields}
        initialData={{ id: 'u1', name: 'Ada' }}
        relationshipData={{ profile: [{ id: 'p1', label: 'Ada' }] }}
        onSubmit={noop}
      />,
    )

    expect(screen.getByText(/Not editable here/)).toBeInTheDocument()
    expect(container.querySelector('[data-slot="combobox-trigger"]')).toBeNull()
  })

  it('marks a write-denied field read-only', async () => {
    const fields = await serializeFieldConfigs(database.context(null), 'Doc', 'update')
    render(
      <ItemEditForm
        fields={fields}
        initialData={{ id: 'd1', title: 'T', score: 7 }}
        onSubmit={noop}
      />,
    )

    expect(screen.queryByRole('spinbutton', { name: 'Score' })).not.toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})
