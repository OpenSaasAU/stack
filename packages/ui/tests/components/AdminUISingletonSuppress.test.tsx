import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { AdminUI } from '../../src/components/AdminUI.js'
import { ItemForm } from '../../src/components/ItemForm.js'
import { SingletonView } from '../../src/components/SingletonView.js'
import { Dashboard } from '../../src/components/Dashboard.js'

// Mock Next.js navigation — AdminUI calls redirect() (server-side) for singleton
// sub-routes, and the form/table client components call useRouter().
const mockPush = vi.fn()
const mockRefresh = vi.fn()
const mockRedirect = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  redirect: (url: string) => mockRedirect(url),
}))

// next/link renders an anchor; happy-dom can render it directly.
vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

/**
 * A config with one singleton list (Settings) and one ordinary list (Post).
 * Built with the real `list()` + field builders so the components see the same
 * field shapes they would in a real app.
 */
const config: OpenSaasConfig = {
  db: { provider: 'sqlite', url: 'file:./test.db' },
  lists: {
    Settings: list({
      isSingleton: true,
      fields: {
        siteName: text(),
      },
    }),
    Post: list({
      fields: {
        title: text(),
      },
    }),
  },
}

interface DelegateStub {
  get?: () => Promise<Record<string, unknown> | null>
  findUnique?: (args: unknown) => Promise<Record<string, unknown> | null>
  findMany?: (args: unknown) => Promise<Array<Record<string, unknown>>>
  count?: (args?: unknown) => Promise<number>
}

/**
 * Build a minimal AccessContext whose db delegates return canned data. Only the
 * methods the views call are implemented.
 */
function makeContext(delegates: Record<string, DelegateStub>): AccessContext {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
  // Cast: this is a stub for rendering tests, not a full Prisma-backed context.
  return context as unknown as AccessContext
}

const noopServerAction = vi.fn(async () => ({ success: true }))

beforeEach(() => {
  mockRedirect.mockClear()
  mockPush.mockClear()
  mockRefresh.mockClear()
})

describe('AdminUI singleton sub-route redirects', () => {
  it('redirects a singleton [list, "create"] to the bare editor route', async () => {
    const context = makeContext({
      settings: { get: vi.fn(async () => ({ id: '1', siteName: 'My Site' })) },
    })

    await AdminUI({
      context,
      config,
      params: ['settings', 'create'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect).toHaveBeenCalledWith('/admin/settings')
  })

  it('redirects a singleton [list, id] to the bare editor route', async () => {
    const context = makeContext({
      settings: { get: vi.fn(async () => ({ id: '1', siteName: 'My Site' })) },
    })

    await AdminUI({
      context,
      config,
      params: ['settings', '1'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    expect(mockRedirect).toHaveBeenCalledTimes(1)
    expect(mockRedirect).toHaveBeenCalledWith('/admin/settings')
  })

  it('honours a custom basePath in the redirect target', async () => {
    const context = makeContext({
      settings: { get: vi.fn(async () => ({ id: '1', siteName: 'My Site' })) },
    })

    await AdminUI({
      context,
      config,
      params: ['settings', 'create'],
      basePath: '/dashboard',
      serverAction: noopServerAction,
    })

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard/settings')
  })

  it('does NOT redirect a singleton bare [list] route (renders the editor)', async () => {
    const context = makeContext({
      settings: { get: vi.fn(async () => ({ id: '1', siteName: 'My Site' })) },
    })

    await AdminUI({
      context,
      config,
      params: ['settings'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('does NOT redirect non-singleton create/edit routes (routing unchanged)', async () => {
    const context = makeContext({
      post: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findUnique: vi.fn(async () => ({ id: '1', title: 'First Post' })),
      },
    })

    // Non-singleton create
    await AdminUI({
      context,
      config,
      params: ['post', 'create'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })
    expect(mockRedirect).not.toHaveBeenCalled()

    // Non-singleton edit
    await AdminUI({
      context,
      config,
      params: ['post', '1'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe('Dashboard create suppression for singletons', () => {
  it('does not render a "Create {singleton}" quick-action but does for a non-singleton', async () => {
    const context = makeContext({
      settings: { count: vi.fn(async () => 1) },
      post: { count: vi.fn(async () => 2) },
    })

    const element = await Dashboard({ context, config, basePath: '/admin' })
    render(element)

    // The Quick Actions block offers "Create" only for the standard list.
    expect(screen.getByText('Create Post')).toBeInTheDocument()
    expect(screen.queryByText('Create Settings')).not.toBeInTheDocument()

    // There is no create link pointing at the singleton anywhere on the dashboard.
    const createLinks = screen.getAllByRole('link', { name: /Create/ })
    for (const link of createLinks) {
      expect(link).not.toHaveAttribute('href', '/admin/settings/create')
    }
  })

  it('hides the Quick Actions card entirely in a singleton-only admin', async () => {
    const singletonOnly: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Settings: list({ isSingleton: true, fields: { siteName: text() } }),
      },
    }
    const context = makeContext({ settings: { count: vi.fn(async () => 1) } })

    const element = await Dashboard({ context, config: singletonOnly, basePath: '/admin' })
    render(element)

    expect(screen.queryByText('Quick Actions')).not.toBeInTheDocument()
    expect(screen.queryByText('Create Settings')).not.toBeInTheDocument()
  })
})

describe('Delete suppression in the singleton editor', () => {
  it('renders no delete control in the singleton editor (SingletonView)', async () => {
    const context = makeContext({
      settings: { get: vi.fn(async () => ({ id: '1', siteName: 'My Site' })) },
    })

    const element = await SingletonView({
      context,
      config,
      listKey: 'Settings',
      basePath: '/admin',
      serverAction: noopServerAction,
    })
    render(element)

    // The edit form renders (Save present) but the Delete affordance is gone.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('still renders the delete control for a non-singleton edit form (ItemForm)', async () => {
    const context = makeContext({
      post: { findUnique: vi.fn(async () => ({ id: '1', title: 'First Post' })) },
    })

    const element = await ItemForm({
      context,
      config,
      listKey: 'Post',
      mode: 'edit',
      itemId: '1',
      basePath: '/admin',
      serverAction: noopServerAction,
    })
    render(element)

    // Non-singleton edit forms keep the delete affordance.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})
