import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { integer, text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { ItemFormClient } from '../../src/components/ItemFormClient.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'
import { FIELD_WRITE_DENIED_REASON } from '../../src/lib/serializeFieldConfig.js'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

/**
 * `secretScore` mirrors `embedding()`'s default (issue #1402): a field a
 * caller may never write, on create AND update alike, because it is derived
 * server-side rather than hand-entered. The operation-level access is wide
 * open — the whole list must still be editable through the admin.
 */
function docConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Doc: {
        fields: {
          title: text(),
          secretScore: integer({ access: { create: () => false, update: () => false } }),
        },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => true,
            delete: () => true,
          },
        },
      },
    },
  }
}

describe('an item form omits a field its own access denies writing (#1402)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(docConfig(), { userId: 'admin' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await harness.truncate()
  })

  it('renders the denied field read-only and saves the rest of the form on edit', async () => {
    const config = docConfig()
    const context = harness.context as unknown as AccessContext

    // `secretScore` is denied at the application layer on both operations, so
    // it is seeded through `sudo()` — the same escape a derived-value hook or
    // plugin would use in production.
    const seeded = await harness.context
      .sudo()
      .db.Doc.create({ data: { title: 'Original', secretScore: 42 } })
    const docId = String(seeded?.id)

    const record = await context.db.Doc.where({ id: docId }).first()
    const prepared = await prepareItemForm(
      context,
      config,
      'Doc',
      config.lists.Doc,
      record as Record<string, unknown>,
      'update',
    )

    // The field is marked read-only with the write-denied reason rather than
    // rendered as a control the save would then have to discard.
    expect(prepared.serializableFields.secretScore.readOnly).toBe(true)
    expect(prepared.serializableFields.secretScore.readOnlyReason).toBe(FIELD_WRITE_DENIED_REASON)

    render(
      <ItemFormClient
        listKey="Doc"
        urlKey="doc"
        mode="edit"
        fields={prepared.serializableFields}
        initialData={prepared.initialData}
        itemId={docId}
        basePath="/admin"
        serverAction={harness.context.serverAction}
        relationshipData={prepared.relationshipData}
      />,
    )

    // No editable control for the denied field — its value is a plain
    // display, not a text box the save could resubmit.
    expect(screen.queryByRole('spinbutton', { name: 'Secret Score' })).not.toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()

    const user = userEvent.setup()
    const titleInput = screen.getByLabelText('Title')
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Falsify-the-fix case: before the payload dropped this field, the whole
    // update was refused ("Cannot update secretScore: field-level access
    // denied") and the form never navigated away.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/doc'))

    const after = await context.db.Doc.where({ id: docId }).first()
    expect(after?.title).toBe('Updated')
    expect(after?.secretScore).toBe(42) // untouched by the save
  })

  it('renders the denied field read-only and saves on create', async () => {
    const config = docConfig()
    const context = harness.context as unknown as AccessContext

    const prepared = await prepareItemForm(context, config, 'Doc', config.lists.Doc, {}, 'create')

    expect(prepared.serializableFields.secretScore.readOnly).toBe(true)
    expect(prepared.serializableFields.secretScore.readOnlyReason).toBe(FIELD_WRITE_DENIED_REASON)

    render(
      <ItemFormClient
        listKey="Doc"
        urlKey="doc"
        mode="create"
        fields={prepared.serializableFields}
        initialData={prepared.initialData}
        basePath="/admin"
        serverAction={harness.context.serverAction}
        relationshipData={prepared.relationshipData}
      />,
    )

    expect(screen.queryByRole('spinbutton', { name: 'Secret Score' })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'Brand New')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/doc'))

    const created = await context.db.Doc.where({ title: { equals: 'Brand New' } }).first()
    expect(created).not.toBeNull()
    expect(created?.secretScore).toBeNull()
  })
})
