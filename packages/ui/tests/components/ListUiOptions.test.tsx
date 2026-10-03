import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { AdminUI } from '../../src/components/AdminUI.js'
import { Dashboard } from '../../src/components/Dashboard.js'
import { ItemForm } from '../../src/components/ItemForm.js'
import { ListView } from '../../src/components/ListView.js'

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/hidden',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: () => {
    throw new Error('notFound')
  },
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

const isViewer = ({ session }: { session: { role?: string } | null }) => session?.role === 'viewer'

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Plain: list({ fields: { title: text() }, access: { operation: OPEN } }),
    Hidden: list({
      fields: { title: text() },
      access: { operation: OPEN },
      ui: { hideCreate: true, hideDelete: true, itemView: { defaultFieldMode: 'read' } },
    }),
    ByRole: list({
      fields: { title: text() },
      access: { operation: OPEN },
      ui: {
        hideCreate: isViewer,
        hideDelete: isViewer,
        itemView: { defaultFieldMode: ({ session }) => (isViewer({ session }) ? 'read' : 'edit') },
      },
    }),
  },
}

const serverAction = vi.fn(async () => ({ success: true }))

let adminHarness: TestContext
let viewerHarness: TestContext
let admin: AccessContext
let viewer: AccessContext
let hiddenId: string
let plainId: string
let byRoleId: string
let viewerByRoleId: string

beforeAll(async () => {
  adminHarness = await createTestContext(config, { role: 'admin' })
  viewerHarness = await createTestContext(config, { role: 'viewer' })
  admin = adminHarness.context as unknown as AccessContext
  viewer = viewerHarness.context as unknown as AccessContext
  hiddenId = String((await adminHarness.context.db.Hidden.create({ data: { title: 'h' } }))?.id)
  plainId = String((await adminHarness.context.db.Plain.create({ data: { title: 'p' } }))?.id)
  byRoleId = String((await adminHarness.context.db.ByRole.create({ data: { title: 'r' } }))?.id)
  viewerByRoleId = String(
    (await viewerHarness.context.db.ByRole.create({ data: { title: 'r' } }))?.id,
  )
}, 120_000)

afterAll(async () => {
  await adminHarness?.close()
  await viewerHarness?.close()
})

const hasCreateLink = (urlKey: string) =>
  screen
    .queryAllByRole('link')
    .some((link) => link.getAttribute('href') === `/admin/${urlKey}/create`)

describe('hideCreate', () => {
  it('renders the create route as not-found for a hidden list only', async () => {
    await expect(
      AdminUI({ context: admin, config, params: ['hidden', 'create'], serverAction }),
    ).rejects.toThrow('notFound')
    await expect(
      AdminUI({ context: admin, config, params: ['plain', 'create'], serverAction }),
    ).resolves.toBeDefined()
  })

  it('resolves a session function per session', async () => {
    await expect(
      AdminUI({ context: viewer, config, params: ['by-role', 'create'], serverAction }),
    ).rejects.toThrow('notFound')
    await expect(
      AdminUI({ context: admin, config, params: ['by-role', 'create'], serverAction }),
    ).resolves.toBeDefined()
  })

  it('removes the list header Create link', async () => {
    render(await ListView({ context: admin, config, listKey: 'Hidden', serverAction }))
    expect(hasCreateLink('hidden')).toBe(false)
  })

  it('removes the empty-state Create link', async () => {
    const empty: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Hidden: config.lists.Hidden },
    }
    const harness = await createTestContext(empty, null)
    try {
      render(
        await ListView({
          context: harness.context as unknown as AccessContext,
          config: empty,
          listKey: 'Hidden',
          serverAction,
        }),
      )
      expect(screen.getByText('No items yet')).toBeInTheDocument()
      expect(hasCreateLink('hidden')).toBe(false)
    } finally {
      await harness.close()
    }
  })

  it('keeps the list header Create link when the option is absent', async () => {
    render(await ListView({ context: admin, config, listKey: 'Plain', serverAction }))
    expect(hasCreateLink('plain')).toBe(true)
  })

  it('removes the dashboard quick action for one session and keeps it for another', async () => {
    const { unmount } = render(await Dashboard({ context: viewer, config }))
    expect(hasCreateLink('by-role')).toBe(false)
    expect(hasCreateLink('hidden')).toBe(false)
    expect(hasCreateLink('plain')).toBe(true)
    unmount()

    render(await Dashboard({ context: admin, config }))
    expect(hasCreateLink('by-role')).toBe(true)
  })
})

describe('hideDelete', () => {
  it('removes the item view Delete button', async () => {
    render(
      await ItemForm({
        context: admin,
        config,
        listKey: 'Hidden',
        mode: 'edit',
        itemId: hiddenId,
        serverAction,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('keeps Delete when the option is absent', async () => {
    render(
      await ItemForm({
        context: admin,
        config,
        listKey: 'Plain',
        mode: 'edit',
        itemId: plainId,
        serverAction,
      }),
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('removes the list view selection affordance', async () => {
    render(await ListView({ context: admin, config, listKey: 'Hidden', serverAction }))
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})

describe('itemView.defaultFieldMode', () => {
  it("renders no Save action in 'read' mode", async () => {
    render(
      await ItemForm({
        context: admin,
        config,
        listKey: 'Hidden',
        mode: 'edit',
        itemId: hiddenId,
        serverAction,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('resolves a session function to read for one session and edit for another', async () => {
    const { unmount } = render(
      await ItemForm({
        context: viewer,
        config,
        listKey: 'ByRole',
        mode: 'edit',
        itemId: viewerByRoleId,
        serverAction,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    unmount()

    render(
      await ItemForm({
        context: admin,
        config,
        listKey: 'ByRole',
        mode: 'edit',
        itemId: byRoleId,
        serverAction,
      }),
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('leaves create mode editable', async () => {
    render(
      await ItemForm({ context: admin, config, listKey: 'Hidden', mode: 'create', serverAction }),
    )
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })
})

describe('client boundary and access', () => {
  it('passes only resolved values, never the option functions, to client components', async () => {
    const element = await ItemForm({
      context: viewer,
      config,
      listKey: 'ByRole',
      mode: 'edit',
      itemId: viewerByRoleId,
      serverAction,
    })
    const walk = (node: React.ReactNode): React.ReactElement[] =>
      React.isValidElement<{ children?: React.ReactNode }>(node)
        ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)]
        : []
    const client = walk(element).find((el) => 'fieldMode' in (el.props as object))
    expect(client).toBeDefined()
    const props = client?.props as Record<string, unknown>
    expect(props.fieldMode).toBe('read')
    expect(props.canDelete).toBe(false)
    const functionProps = Object.entries(props)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key)
    expect(functionProps).toEqual(['serverAction'])
  })

  it('does not change access: a secured create on a hideCreate list still succeeds', async () => {
    const created = await adminHarness.context.db.Hidden.create({ data: { title: 'via db' } })
    expect(created).not.toBeNull()
  })
})
