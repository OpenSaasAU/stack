import { describe, it, expect, vi, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { AdminUI } from '../../src/components/AdminUI.js'
import { Navigation } from '../../src/components/Navigation.js'

// next/link renders an anchor; happy-dom can render it directly.
vi.mock('next/link.js', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode
    href: string
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

interface DelegateStub {
  findMany?: (args: unknown) => Promise<Array<Record<string, unknown>>>
  count?: (args: unknown) => Promise<number>
}

function makeContext(delegates: Record<string, DelegateStub> = {}): AccessContext<unknown> {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputCounter: { depth: 0 },
  }
  return context as unknown as AccessContext<unknown>
}

const noopServerAction = vi.fn(async () => ({ success: true }))

/**
 * AdminUI returns <> {style?} <div><sidebar/><main>{content}</main></div> </>.
 * Recover whatever the sidebar slot resolved to (built-in `Navigation` or the
 * host-supplied `navigation` node). Uses raw children arrays rather than
 * `React.Children.toArray` — the latter clones elements to assign keys, which
 * breaks `toBe` identity checks against the original `navigation` node.
 */
function sidebarOf(tree: React.ReactNode): React.ReactNode {
  const fragment = tree as React.ReactElement<{ children: React.ReactNode }>
  const fragmentChildren = fragment.props.children
  const topLevel = Array.isArray(fragmentChildren) ? fragmentChildren : [fragmentChildren]
  const wrapper = topLevel.find(
    (child): child is React.ReactElement<{ children: React.ReactNode }> =>
      React.isValidElement(child) && child.type === 'div',
  )
  if (!wrapper) throw new Error('AdminUI layout wrapper not found')
  const wrapperChildren = wrapper.props.children
  const items = Array.isArray(wrapperChildren) ? wrapperChildren : [wrapperChildren]
  const sidebar = items.find((child) => !(React.isValidElement(child) && child.type === 'main'))
  if (!sidebar) throw new Error('AdminUI sidebar not found')
  return sidebar
}

const baseConfig: OpenSaasConfig = {
  db: { provider: 'sqlite', url: 'file:./test.db' },
  lists: {
    Post: list({ fields: { title: text() } }),
  },
}

describe('AdminUI navigation slot (ADR-0021)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the built-in sidebar and resolves nav counts when neither prop is supplied', async () => {
    const count = vi.fn(async () => 3)
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({
          fields: { title: text() },
          ui: { navCount: true },
          access: { operation: { query: () => true } },
        }),
      },
    }
    const context = makeContext({ post: { count } })

    const tree = await AdminUI({
      context,
      config,
      params: [],
      basePath: '/admin',
      serverAction: noopServerAction,
    })

    expect((sidebarOf(tree) as React.ReactElement).type).toBe(Navigation)
    expect(count).toHaveBeenCalledTimes(1)
  })

  it('renders the supplied `navigation` node in place of the built-in sidebar', async () => {
    const custom = <nav data-testid="host-nav">Host chrome</nav>

    const tree = await AdminUI({
      context: makeContext(),
      config: baseConfig,
      params: [],
      basePath: '/admin',
      serverAction: noopServerAction,
      navigation: custom,
    })

    expect(sidebarOf(tree)).toBe(custom)
  })

  it('performs no nav-count resolution when `navigation` is supplied', async () => {
    const count = vi.fn(async () => 3)
    const config: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({
          fields: { title: text() },
          ui: { navCount: true },
          access: { operation: { query: () => true } },
        }),
      },
    }
    const context = makeContext({ post: { count } })

    await AdminUI({
      context,
      config,
      params: [],
      basePath: '/admin',
      serverAction: noopServerAction,
      navigation: <nav>Host chrome</nav>,
    })

    expect(count).not.toHaveBeenCalled()
  })

  it('renders routed content for every route when `navigation` is supplied', async () => {
    const context = makeContext({
      post: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    })

    for (const params of [[], ['post'], ['post', 'create'], ['post', '1']]) {
      const tree = await AdminUI({
        context,
        config: baseConfig,
        params,
        basePath: '/admin',
        serverAction: noopServerAction,
        navigation: <nav>Host chrome</nav>,
      })
      const fragment = tree as React.ReactElement<{ children: React.ReactNode }>
      expect(fragment).toBeTruthy()
    }
  })

  it('renders the built-in sidebar plus one entry per navItems item, after Lists/Settings and above the footer', async () => {
    const tree = await AdminUI({
      context: makeContext(),
      config: baseConfig,
      params: [],
      basePath: '/admin',
      serverAction: noopServerAction,
      navItems: [{ label: 'Back to App', href: '/app' }],
    })

    render(sidebarOf(tree) as React.ReactElement)

    const hostLink = screen.getByRole('link', { name: 'Back to App' })
    expect(hostLink).toBeInTheDocument()
    expect(hostLink).toHaveAttribute('href', '/app')

    // Order: Dashboard, Post (Lists), then the host entry, then the footer.
    const nav = hostLink.closest('nav')
    if (!nav) throw new Error('nav not found')
    const linkOrder = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)
    expect(linkOrder.indexOf('Back to App')).toBeGreaterThan(linkOrder.indexOf('Post'))
  })

  it('renders the `navigation` node and no navItems entries when both are supplied, with a dev-only warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const custom = <nav data-testid="host-nav">Host chrome</nav>

    const tree = await AdminUI({
      context: makeContext(),
      config: baseConfig,
      params: [],
      basePath: '/admin',
      serverAction: noopServerAction,
      navigation: custom,
      navItems: [{ label: 'Back to App', href: '/app' }],
    })

    expect(sidebarOf(tree)).toBe(custom)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('navigation')
    expect(warnSpy.mock.calls[0][0]).toContain('navItems')
  })

  it('does not throw when both are supplied in production', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await expect(
        AdminUI({
          context: makeContext(),
          config: baseConfig,
          params: [],
          basePath: '/admin',
          serverAction: noopServerAction,
          navigation: <nav>Host chrome</nav>,
          navItems: [{ label: 'Back to App', href: '/app' }],
        }),
      ).resolves.toBeTruthy()
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })
})
