import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { Navigation } from '../../src/components/Navigation.js'

// next/link renders an anchor; forward all props so aria-current/data-active survive.
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

// Anonymous context: renders the bare ThemeToggle footer (no UserMenu), keeping
// the test focused on the navigation links.
const context = {
  db: {},
  session: null,
  storage: {},
  plugins: {},
  _isSudo: false,
  _resolveOutputChain: [],
} as unknown as AccessContext

describe('Navigation active state', () => {
  it('marks the current list link active with aria-current="page"', () => {
    render(<Navigation context={context} config={config} basePath="/admin" currentPath="/post" />)

    const postLink = screen.getByRole('link', { name: /Post/ })
    expect(postLink).toHaveAttribute('aria-current', 'page')
    expect(postLink).toHaveAttribute('data-active', '')
  })

  it('does not mark non-current links active', () => {
    render(<Navigation context={context} config={config} basePath="/admin" currentPath="/post" />)

    const authorLink = screen.getByRole('link', { name: /Author/ })
    expect(authorLink).not.toHaveAttribute('aria-current')
    expect(authorLink).not.toHaveAttribute('data-active')
  })

  it('marks the Dashboard link active on the root path', () => {
    render(<Navigation context={context} config={config} basePath="/admin" currentPath="" />)

    const dashboardLink = screen.getByRole('link', { name: /Dashboard/ })
    expect(dashboardLink).toHaveAttribute('aria-current', 'page')

    // A list link is not active on the dashboard route.
    const postLink = screen.getByRole('link', { name: /Post/ })
    expect(postLink).not.toHaveAttribute('aria-current')
  })

  it('uses a solid brand fill for the active link, not a gradient', () => {
    render(<Navigation context={context} config={config} basePath="/admin" currentPath="/post" />)

    const postLink = screen.getByRole('link', { name: /Post/ })
    expect(postLink.className).toContain('bg-primary')
    // Gradient is reserved for signature moments — never the active nav item.
    expect(postLink.className).not.toContain('gradient')
    expect(postLink.className).not.toContain('animate-pulse')
  })
})
