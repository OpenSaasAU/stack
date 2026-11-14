import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render, screen } from '@testing-library/react'
import type { OpenSaasConfig, Session } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { Dashboard } from '../../src/components/Dashboard.js'
import { ItemForm } from '../../src/components/ItemForm.js'

vi.mock('next/navigation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation.js')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/note',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const BOOT = 120_000

type RuleArgs = { session: Session | null }

function adminOrNothing(args: RuleArgs): boolean
function adminOrNothing({ session }: RuleArgs): boolean | null | undefined {
  if (session?.role === 'admin') return true
  return session?.role === 'returns-null' ? null : undefined
}

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Note: {
      fields: { body: text() },
      access: {
        operation: {
          query: () => true,
          create: adminOrNothing,
          update: () => true,
          delete: adminOrNothing,
        },
      },
    },
  },
}

const serverAction = async () => null

let database: TestDatabase
let noteId: string | number

beforeAll(async () => {
  database = await createTestDatabase(config)
  const note = await database
    .context(null)
    .sudo()
    .db.Note.create({ data: { body: 'A readable note' } })
  const id = note?.id
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new Error('the seed note was not created')
  }
  noteId = id
}, BOOT)

afterAll(async () => {
  await database?.close()
})

afterEach(() => {
  cleanup()
})

const denied = [
  ['null', 'returns-null'],
  ['undefined', 'returns-undefined'],
]

async function dashboardHtml(session: Session): Promise<string> {
  return renderToStaticMarkup(
    await Dashboard({ context: database.context(session), config, basePath: '/admin' }),
  )
}

async function renderItemForm(session: Session, mode: 'create' | 'edit') {
  return render(
    await ItemForm({
      context: database.context(session),
      config,
      listKey: 'Note',
      mode,
      itemId: mode === 'edit' ? noteId : undefined,
      basePath: '/admin',
      serverAction,
    }),
  )
}

describe('the dashboard offers Create only where the Session vocabulary allows it', () => {
  it.each(denied)(
    'offers no Create link when the create rule returns %s',
    async (_label, role) => {
      const html = await dashboardHtml({ role })
      expect(html).toContain('Note')
      expect(html).not.toContain('href="/admin/note/create"')
    },
    BOOT,
  )

  it(
    'offers the Create link where create is allowed',
    async () => {
      expect(await dashboardHtml({ role: 'admin' })).toContain('href="/admin/note/create"')
    },
    BOOT,
  )
})

describe('the create route renders no form where the Session vocabulary denies create', () => {
  it.each(denied)(
    'renders the unavailable state when the create rule returns %s',
    async (_label, role) => {
      const { container } = await renderItemForm({ role }, 'create')
      expect(container.querySelector('[data-slot="item-create-unavailable"]')).not.toBeNull()
      expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
    },
    BOOT,
  )

  it(
    'renders the create form where create is allowed',
    async () => {
      const { container } = await renderItemForm({ role: 'admin' }, 'create')
      expect(container.querySelector('[data-slot="item-create-unavailable"]')).toBeNull()
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    },
    BOOT,
  )
})

describe('the item page offers Delete only where the Session vocabulary allows it', () => {
  it.each(denied)(
    'offers no Delete when the delete rule returns %s',
    async (_label, role) => {
      await renderItemForm({ role }, 'edit')
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    },
    BOOT,
  )

  it(
    'offers Delete where delete is allowed',
    async () => {
      await renderItemForm({ role: 'admin' }, 'edit')
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    },
    BOOT,
  )
})
