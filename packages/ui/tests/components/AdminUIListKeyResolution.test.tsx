import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { createTestContext, type TestContext } from '@opensaas/stack-core/testing'
import { AdminUI } from '../../src/components/AdminUI.js'
import { ListView } from '../../src/components/ListView.js'
import { ItemForm } from '../../src/components/ItemForm.js'
import { Dashboard } from '../../src/components/Dashboard.js'

// Mock Next.js navigation — client components call useRouter().
const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  notFound: () => {
    throw new Error('notFound')
  },
}))

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const noopServerAction = vi.fn(async () => ({ success: true }))

/**
 * AdminUI returns <> {style?} <div><Navigation/><main>{content}</main></div> </>.
 * Drill into <main> to recover the routed content element so we can inspect
 * the props AdminUI passed to it.
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
  const boundary = main.props.children as React.ReactElement<{ children: React.ReactNode }>
  if (React.isValidElement(boundary) && boundary.type === React.Suspense) {
    return boundary.props.children as React.ReactElement
  }
  return boundary
}

// A camelCase list key, matching what a better-auth plugin (e.g. the MCP
// plugin's OAuth tables) derives before issue #991's auth-side fix — the
// admin UI's routing must round-trip it regardless.
function camelCaseListConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      oauthApplication: list({ fields: { clientId: text() } }),
      BlogPost: list({ fields: { title: text() } }),
    },
  }
}

describe('AdminUI list URL resolution (issue #991)', () => {
  let harness: TestContext
  let context: AccessContext

  beforeAll(async () => {
    harness = await createTestContext(camelCaseListConfig(), null)
    context = harness.context as unknown as AccessContext
  }, 120_000)

  afterAll(async () => {
    await harness?.close()
  })

  it('resolves a camelCase list key from its URL segment and opens the list view', async () => {
    const config = camelCaseListConfig()

    const tree = await AdminUI({
      context,
      config,
      params: ['oauth-application'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    const content = routedContent(tree)
    expect(content.type).toBe(ListView)
    expect(content.props.listKey).toBe('oauthApplication')
  })

  it('resolves the create route for a camelCase list key', async () => {
    const config = camelCaseListConfig()

    const tree = await AdminUI({
      context,
      config,
      params: ['oauth-application', 'create'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    const content = routedContent(tree)
    expect(content.type).toBe(ItemForm)
    expect(content.props.listKey).toBe('oauthApplication')
    expect(content.props.mode).toBe('create')
  })

  it('resolves an item edit route for a camelCase list key', async () => {
    const config = camelCaseListConfig()

    const tree = await AdminUI({
      context,
      config,
      params: ['oauth-application', '019606b0-1f36-7000-8000-0000000000ab'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    const content = routedContent(tree)
    expect(content.type).toBe(ItemForm)
    expect(content.props.listKey).toBe('oauthApplication')
    expect(content.props.mode).toBe('edit')
    expect(content.props.itemId).toBe('019606b0-1f36-7000-8000-0000000000ab')
  })

  it('still resolves a PascalCase list key exactly as before', async () => {
    const config = camelCaseListConfig()

    const tree = await AdminUI({
      context,
      config,
      params: ['blog-post'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    const content = routedContent(tree)
    expect(content.type).toBe(ListView)
    expect(content.props.listKey).toBe('BlogPost')
  })

  it('renders the dashboard at the root, not a list view', async () => {
    const config = camelCaseListConfig()

    const tree = await AdminUI({
      context,
      config,
      params: [],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    const content = routedContent(tree)
    expect(content.type).toBe(Dashboard)
  })

  it('falls through to the list-not-found state for a URL matching no list, instead of throwing', async () => {
    const config = camelCaseListConfig()

    const tree = await AdminUI({
      context,
      config,
      params: ['does-not-exist'],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    // Not the dashboard fallback — the route still resolves to a list screen,
    // which renders its own "List not found" state for the unresolved key.
    const content = routedContent(tree)
    expect(content.type).toBe(ListView)
    expect(content.props.listKey).toBe('does-not-exist')
  })
})
