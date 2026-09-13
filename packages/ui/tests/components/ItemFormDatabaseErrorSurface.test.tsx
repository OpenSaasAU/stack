import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { ItemFormClient } from '../../src/components/ItemFormClient.js'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'

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

function authorConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Author: {
        fields: { email: text({ isIndexed: 'unique' }) },
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

/**
 * Pins the full chain a hand-built error object cannot (#1334): `withOrigin`
 * classifies a GENUINE PostgreSQL unique-violation raised by
 * `createTestContext`'s own database, `normalizeDatabaseError` resolves it
 * through the generated constraint map, `serverAction` returns
 * `{ success, error, fieldErrors }`, and `ItemFormClient`/`useItemForm` land
 * it in form state. A break at any single link is what this test exists to
 * catch — see the issue for the four ways that happened in miniature during
 * PR #1325's merge.
 *
 * Because this suite lives in `packages/ui` but names a fault path through
 * `packages/core`, a mutation under `packages/core/src` is only observed here
 * after core is rebuilt (#1302) — `pnpm --filter @opensaas/stack-core build`,
 * or `turbo run test --filter=./packages/ui...` from the repo root, which
 * rebuilds the dependency automatically. A mutation under `packages/ui/src`
 * needs no such step.
 */
describe('a genuine unique-constraint violation surfaces in item form state (#1334)', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(authorConfig(), { userId: 'admin' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await harness.truncate()
  })

  it(
    'lands a per-field message on the colliding field and leaks no driver text',
    async () => {
      const config = authorConfig()
      const context = harness.context as unknown as AccessContext
      const collidingEmail = 'taken@example.com'

      await harness.context.db.Author.create({ data: { email: collidingEmail } })

      const prepared = await prepareItemForm(
        context,
        config,
        'Author',
        config.lists.Author,
        {},
        'create',
      )

      render(
        <ItemFormClient
          listKey="Author"
          urlKey="author"
          mode="create"
          fields={prepared.serializableFields}
          initialData={prepared.initialData}
          basePath="/admin"
          serverAction={harness.context.serverAction}
          relationshipData={prepared.relationshipData}
        />,
      )

      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Email'), collidingEmail)
      await user.click(screen.getByRole('button', { name: 'Create' }))

      // The useful half: a per-field message, resolved through the generated
      // constraint map (`Author_email_key`), lands on the email field.
      const fieldError = await screen.findByText('This email is already in use')
      expect(fieldError).toBeInTheDocument()

      // The write was refused — the form never navigated away.
      expect(mockPush).not.toHaveBeenCalled()

      // The silent half, asserted explicitly by absence: the rendered error
      // carries none of PostgreSQL's own detail line. The colliding value
      // legitimately appears in the input the user typed it into, so this
      // checks the error node's own text, not the whole document.
      expect(fieldError.textContent).not.toContain(collidingEmail)
      expect(fieldError.textContent).not.toContain('already exists')
      expect(fieldError.textContent).not.toContain('Key (')
      expect(fieldError.textContent).not.toContain('Author_email_key')

      const rows = await context.db.Author.where({ email: { equals: collidingEmail } }).all()
      expect(rows).toHaveLength(1) // the seed row only — the duplicate insert never landed
    },
    BOOT,
  )
})
