import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text, timestamp } from '@opensaas/stack-core/fields'
import { AdminUI } from '../../src/components/AdminUI.js'
import { ListView } from '../../src/components/ListView.js'

// Mock Next.js navigation — client components call useRouter().
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

interface DelegateStub {
  findMany?: (args: unknown) => Promise<Array<Record<string, unknown>>>
  count?: (args: unknown) => Promise<number>
}

function makeContext(delegates: Record<string, DelegateStub>): AccessContext {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
  return context as unknown as AccessContext
}

const noopServerAction = vi.fn(async () => ({ success: true }))

/**
 * AdminUI returns <> {style?} <div><Navigation/><main>{content}</main></div> </>.
 * Drill into <main> to recover the routed content element (the <ListView /> the
 * router chose for the bare [list] route) so we can inspect the props AdminUI
 * passed to it.
 */
function routedContent(tree: React.ReactNode): React.ReactElement {
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
  // <main> wraps the routed content in a <Suspense> skeleton boundary; unwrap it
  // to reach the routed screen component the router selected.
  const boundary = main.props.children as React.ReactElement<{ children: React.ReactNode }>
  if (React.isValidElement(boundary) && boundary.type === React.Suspense) {
    return boundary.props.children as React.ReactElement
  }
  return boundary
}

describe('AdminUI ui.listView wiring', () => {
  it('passes orderBy to findMany based on initialSort', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)

    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({
          fields: { title: text(), sentAt: timestamp() },
          ui: {
            listView: {
              initialSort: { field: 'sentAt', direction: 'desc' },
            },
          },
        }),
      },
    }

    const context = makeContext({ post: { findMany, count } })

    await ListView({
      context,
      config,
      listKey: 'Post',
      basePath: '/admin',
      initialSort: { field: 'sentAt', direction: 'desc' },
    })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { sentAt: 'desc' } }))
  })

  it('URL sort param takes precedence over initialSort in orderBy', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)

    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({
          fields: { title: text(), sentAt: timestamp() },
          ui: {
            listView: {
              initialSort: { field: 'sentAt', direction: 'desc' },
            },
          },
        }),
      },
    }

    const context = makeContext({ post: { findMany, count } })

    await ListView({
      context,
      config,
      listKey: 'Post',
      basePath: '/admin',
      initialSort: { field: 'sentAt', direction: 'desc' },
      sort: { field: 'title', direction: 'asc' },
    })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { title: 'asc' } }))
  })

  it('discards URL sort param when field does not exist on the list, falling back to initialSort', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)

    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({
          fields: { title: text(), sentAt: timestamp() },
          ui: {
            listView: {
              initialSort: { field: 'sentAt', direction: 'desc' },
            },
          },
        }),
      },
    }

    const context = makeContext({ post: { findMany, count } })

    await ListView({
      context,
      config,
      listKey: 'Post',
      basePath: '/admin',
      initialSort: { field: 'sentAt', direction: 'desc' },
      sort: { field: 'nonExistentField', direction: 'asc' },
    })

    // Unknown field is rejected; falls back to initialSort.
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { sentAt: 'desc' } }))
  })

  it('passes initialColumns + initialSort from ui.listView to ListView', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({
          fields: {
            title: text(),
            status: text(),
            createdAt: timestamp(),
          },
          ui: {
            listView: {
              initialColumns: ['title', 'status'],
              initialSort: { field: 'createdAt', direction: 'desc' },
            },
          },
        }),
      },
    }

    const context = makeContext({
      post: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    })

    const tree = await AdminUI({
      context,
      config,
      params: ['post'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    const content = routedContent(tree)
    expect(content.type).toBe(ListView)
    // initialColumns drives the `columns` prop (selection + order).
    expect(content.props.columns).toEqual(['title', 'status'])
    // initialSort flows through as the default sort.
    expect(content.props.initialSort).toEqual({ field: 'createdAt', direction: 'desc' })
  })

  it('passes undefined columns + initialSort when ui.listView is absent', async () => {
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({
          fields: {
            title: text(),
          },
        }),
      },
    }

    const context = makeContext({
      post: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    })

    const tree = await AdminUI({
      context,
      config,
      params: ['post'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    const content = routedContent(tree)
    expect(content.type).toBe(ListView)
    // Absent config → current behaviour unchanged (no column override, no default sort).
    expect(content.props.columns).toBeUndefined()
    expect(content.props.initialSort).toBeUndefined()
  })
})
