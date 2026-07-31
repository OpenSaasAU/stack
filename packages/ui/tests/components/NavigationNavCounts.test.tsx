import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { Navigation } from '../../src/components/Navigation.js'

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

const config: OpenSaasConfig = {
  db: { provider: 'sqlite', url: 'file:./test.db' },
  lists: {
    Post: list({ fields: { title: text() } }),
    Author: list({ fields: { name: text() } }),
  },
}

const context = {
  db: {},
  session: null,
  storage: {},
  plugins: {},
  _isSudo: false,
  _resolveOutputChain: [],
} as unknown as AccessContext<unknown>

/**
 * Nav counts (issue #735) are pre-resolved upstream and passed as `navCounts`;
 * Navigation only renders a badge for lists present in that map.
 */
describe('Navigation nav counts', () => {
  it('renders a nav-count badge for a list present in navCounts', () => {
    render(
      <Navigation
        context={context}
        config={config}
        basePath="/admin"
        currentPath=""
        navCounts={{ Post: 12 }}
      />,
    )

    const postLink = screen.getByRole('link', { name: /Post/ })
    const badge = postLink.querySelector('[data-slot="nav-count"]')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('12')
  })

  it('renders no badge for a list absent from navCounts (opt-in / statically-denied)', () => {
    render(
      <Navigation
        context={context}
        config={config}
        basePath="/admin"
        currentPath=""
        navCounts={{ Post: 12 }}
      />,
    )

    const authorLink = screen.getByRole('link', { name: /Author/ })
    expect(authorLink.querySelector('[data-slot="nav-count"]')).toBeNull()
  })

  it('renders a "0" badge (session sees none) distinct from no badge', () => {
    render(
      <Navigation
        context={context}
        config={config}
        basePath="/admin"
        currentPath=""
        navCounts={{ Post: 0 }}
      />,
    )

    const postLink = screen.getByRole('link', { name: /Post/ })
    expect(postLink.querySelector('[data-slot="nav-count"]')).toHaveTextContent('0')
  })

  it('renders no badges at all when navCounts is omitted', () => {
    const { container } = render(
      <Navigation context={context} config={config} basePath="/admin" currentPath="" />,
    )
    expect(container.querySelector('[data-slot="nav-count"]')).toBeNull()
  })
})
