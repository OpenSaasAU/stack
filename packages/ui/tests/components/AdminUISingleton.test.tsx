import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { AdminUI } from '../../src/components/AdminUI.js'
import { SingletonView } from '../../src/components/SingletonView.js'
import { ListView } from '../../src/components/ListView.js'

// Mock Next.js navigation — the form/table client components call useRouter().
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

// next/link renders an anchor; happy-dom can render it directly.
vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

/**
 * A config with one singleton list (Settings) and one ordinary list (Post).
 * Built with the real `list()` + field builders so the components see the
 * same field shapes they would in a real app.
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
  count?: (args: unknown) => Promise<number>
}

/**
 * Build a minimal AccessContext whose db delegates return canned data.
 * Only the methods the views call are implemented.
 */
function makeContext(delegates: Record<string, DelegateStub>): AccessContext<unknown> {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputCounter: { depth: 0 },
  }
  // Cast: this is a stub for rendering tests, not a full Prisma-backed context.
  return context as unknown as AccessContext<unknown>
}

const noopServerAction = vi.fn(async () => ({ success: true }))

// React represents `<Component />` as an element whose `.type` is the component
// function. The router picks the component but does not await it (nested server
// components resolve during streaming, not in this unit), so we assert the
// branch by inspecting which component AdminUI chose for the bare [list] route.
function routedContent(tree: React.ReactNode): React.ReactElement {
  // AdminUI returns <> {style?} <div><Navigation/><main>{content}</main></div> </>
  const fragment = tree as React.ReactElement<{ children: React.ReactNode }>
  const children = React.Children.toArray(fragment.props.children)
  const wrapper = children.find(
    (child): child is React.ReactElement<{ children: React.ReactNode }> =>
      React.isValidElement(child) && child.type === 'div',
  )
  if (!wrapper) throw new Error('AdminUI layout wrapper not found')
  const main = React.Children.toArray(wrapper.props.children).find(
    (child): child is React.ReactElement<{ children: React.ReactNode }> =>
      React.isValidElement(child) && child.type === 'main',
  )
  if (!main) throw new Error('AdminUI <main> not found')
  return main.props.children as React.ReactElement
}

describe('AdminUI singleton routing', () => {
  it('routes a singleton bare [list] to SingletonView, a non-singleton to ListView', async () => {
    const context = makeContext({
      settings: { get: vi.fn(async () => ({ id: '1', siteName: 'My Site' })) },
      post: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    })

    const singletonTree = await AdminUI({
      context,
      config,
      params: ['settings'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })
    expect(routedContent(singletonTree).type).toBe(SingletonView)

    const listTree = await AdminUI({
      context,
      config,
      params: ['post'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })
    expect(routedContent(listTree).type).toBe(ListView)
  })

  it('renders a single-record editor for a singleton list (SingletonView)', async () => {
    const singletonGet = vi.fn(async () => ({ id: '1', siteName: 'My Site' }))
    const context = makeContext({ settings: { get: singletonGet } })

    const element = await SingletonView({
      context,
      config,
      listKey: 'Settings',
      basePath: '/admin',
      serverAction: noopServerAction,
    })
    render(element)

    // Resolved via the singleton get() (auto-create path), not findMany.
    expect(singletonGet).toHaveBeenCalledTimes(1)

    // Editor header + the record's value rendered in a field input.
    expect(screen.getByText('Edit Settings')).toBeInTheDocument()
    expect(screen.getByDisplayValue('My Site')).toBeInTheDocument()

    // Save button (edit form), not a list-table "Create" affordance.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByText('Create Settings')).not.toBeInTheDocument()
  })

  it('renders the list table for a non-singleton list (ListView)', async () => {
    const findMany = vi.fn(async () => [
      { id: '1', title: 'First Post' },
      { id: '2', title: 'Second Post' },
    ])
    const count = vi.fn(async () => 2)
    const context = makeContext({ post: { findMany, count } })

    const element = await ListView({
      context,
      config,
      listKey: 'Post',
      basePath: '/admin',
    })
    render(element)

    // List view fetches via findMany/count (the singleton get() is never called).
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(count).toHaveBeenCalledTimes(1)

    // The list table renders rows + the "Create" affordance.
    expect(screen.getByText('First Post')).toBeInTheDocument()
    expect(screen.getByText('Second Post')).toBeInTheDocument()
    expect(screen.getByText('Create Post')).toBeInTheDocument()

    // It is NOT the singleton editor.
    expect(screen.queryByText('Edit Post')).not.toBeInTheDocument()
  })
})
