// @vitest-environment node
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text, timestamp } from '@opensaas/stack-core/fields'
import { createTestDatabase, type TestDatabase } from '@opensaas/stack-core/testing'
import { AdminUI } from '../../src/components/AdminUI.js'
import { ListView } from '../../src/components/ListView.js'
import { ListViewClient, type ListViewClientProps } from '../../src/components/ListViewClient.js'

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

describe('ListView sort resolution over the Test context', () => {
  const sortConfig: OpenSaasConfig = {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: list({
        fields: { title: text({ validation: { isRequired: true } }), sentAt: timestamp() },
        ui: { listView: { initialSort: { field: 'sentAt', direction: 'desc' } } },
        access: { operation: { query: () => true } },
      }),
    },
  }

  let database: TestDatabase

  function listViewClientProps(tree: React.ReactElement): ListViewClientProps {
    const outer = tree as React.ReactElement<{ children: React.ReactNode }>
    const client = React.Children.toArray(outer.props.children).find(
      (child): child is React.ReactElement<ListViewClientProps> =>
        React.isValidElement(child) && child.type === ListViewClient,
    )
    if (!client) throw new Error('ListViewClient not found in ListView output')
    return client.props
  }

  async function titles(
    props: Omit<Parameters<typeof ListView>[0], 'context' | 'config' | 'basePath'>,
  ): Promise<string[]> {
    const tree = await ListView({
      context: database.context(null) as unknown as AccessContext,
      config: sortConfig,
      basePath: '/admin',
      ...props,
    })
    return listViewClientProps(tree).items.map((item) => String(item.title))
  }

  beforeAll(async () => {
    database = await createTestDatabase(sortConfig)
    const db = database.context(null).sudo().db.Post
    await db.create({ data: { title: 'alpha', sentAt: new Date('2024-01-01T00:00:00Z') } })
    await db.create({ data: { title: 'bravo', sentAt: new Date('2024-03-01T00:00:00Z') } })
    await db.create({ data: { title: 'charlie', sentAt: new Date('2024-02-01T00:00:00Z') } })
  }, 120_000)

  afterAll(async () => {
    await database?.close()
  })

  it('orders by initialSort when no URL sort is given', async () => {
    expect(
      await titles({ listKey: 'Post', initialSort: { field: 'sentAt', direction: 'desc' } }),
    ).toEqual(['bravo', 'charlie', 'alpha'])
  }, 120_000)

  it('lets the URL sort param take precedence over initialSort', async () => {
    expect(
      await titles({
        listKey: 'Post',
        initialSort: { field: 'sentAt', direction: 'desc' },
        sort: { field: 'title', direction: 'asc' },
      }),
    ).toEqual(['alpha', 'bravo', 'charlie'])
  }, 120_000)

  it('discards a URL sort naming a field the list does not have, falling back to initialSort', async () => {
    expect(
      await titles({
        listKey: 'Post',
        initialSort: { field: 'sentAt', direction: 'desc' },
        sort: { field: 'nonExistentField', direction: 'asc' },
      }),
    ).toEqual(['bravo', 'charlie', 'alpha'])
  }, 120_000)
})

describe('AdminUI ui.listView wiring', () => {
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
      Post: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
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
      Post: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
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
