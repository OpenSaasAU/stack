import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { Navigation } from '../../src/components/Navigation.js'
import { Dashboard } from '../../src/components/Dashboard.js'

// next/link renders an anchor; happy-dom can render it directly.
vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

/**
 * A config with one singleton list (SiteConfig) and one ordinary list (Post).
 * Built with the real `list()` + field builders so the components see the same
 * field shapes they would in a real app. The singleton is deliberately NOT
 * named "Settings" so its link label can't be confused with the "Settings"
 * group heading.
 */
const config: OpenSaasConfig = {
  db: { provider: 'sqlite', url: 'file:./test.db' },
  lists: {
    SiteConfig: list({
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
  count?: (args?: unknown) => Promise<number>
}

/**
 * Build a minimal AccessContext whose db delegates return canned data. Only the
 * methods the views call are implemented.
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

describe('Navigation singleton grouping', () => {
  it('renders singletons under a "Settings" group and non-singletons under "Lists"', () => {
    const context = makeContext({})

    render(<Navigation context={context} config={config} basePath="/admin" />)

    // Both group headings are present.
    expect(screen.getByText('Lists')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()

    // The non-singleton Post links to its editor under the "Lists" group, and the
    // singleton SiteConfig links to its editor under the "Settings" group. Both
    // point at the bare [list] route (the editor).
    const postLink = screen.getByRole('link', { name: /Post/ })
    expect(postLink).toHaveAttribute('href', '/admin/post')

    const siteConfigLink = screen.getByRole('link', { name: /Site Config/ })
    expect(siteConfigLink).toHaveAttribute('href', '/admin/site-config')
  })

  it('does not render a "Settings" group when there are no singletons', () => {
    const noSingletons: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Post: list({ fields: { title: text() } }),
      },
    }
    const context = makeContext({})

    render(<Navigation context={context} config={noSingletons} basePath="/admin" />)

    expect(screen.getByText('Lists')).toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
  })

  it('does not render a "Lists" group when there are only singletons', () => {
    const onlySingletons: OpenSaasConfig = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        SiteConfig: list({ isSingleton: true, fields: { siteName: text() } }),
      },
    }
    const context = makeContext({})

    render(<Navigation context={context} config={onlySingletons} basePath="/admin" />)

    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.queryByText('Lists')).not.toBeInTheDocument()
  })
})

describe('Dashboard singleton affordance', () => {
  it('shows "Configure" for a singleton (no count) and a count for a non-singleton', async () => {
    const siteConfigCount = vi.fn(async () => 1)
    const postCount = vi.fn(async () => 2)
    const context = makeContext({
      siteConfig: { count: siteConfigCount },
      post: { count: postCount },
    })

    const element = await Dashboard({ context, config, basePath: '/admin' })
    render(element)

    // Non-singleton Post card shows the normal "N items" count.
    expect(screen.getByText('2 items')).toBeInTheDocument()

    // The singleton card shows a "Configure" affordance and links to the editor.
    const configureLink = screen.getByRole('link', { name: /Configure/ })
    expect(configureLink).toHaveAttribute('href', '/admin/site-config')
    expect(within(configureLink).getByText('Site Config')).toBeInTheDocument()

    // The singleton's count() is never called — its count is misleading, so the
    // dashboard does not query or render it.
    expect(siteConfigCount).not.toHaveBeenCalled()
    expect(postCount).toHaveBeenCalledTimes(1)

    // No "N items" label appears for the singleton.
    expect(screen.queryByText('1 item')).not.toBeInTheDocument()
  })
})
