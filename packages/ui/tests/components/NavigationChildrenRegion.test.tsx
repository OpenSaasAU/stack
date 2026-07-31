import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import { Navigation, NavLink } from '../../src/components/Navigation.js'

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

describe('Navigation children region (ADR-0021)', () => {
  it('with no children, produces unchanged output', () => {
    render(<Navigation context={context} config={config} basePath="/admin" currentPath="" />)

    // Only the header wordmark + built-in Dashboard/Lists links are present —
    // no extra region rendered when children is absent.
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Post' })).toBeInTheDocument()
  })

  it('renders children after Lists/Settings and above the footer', () => {
    render(
      <Navigation context={context} config={config} basePath="/admin" currentPath="">
        <NavLink href="/app">Back to App</NavLink>
      </Navigation>,
    )

    const hostLink = screen.getByRole('link', { name: 'Back to App' })
    expect(hostLink).toBeInTheDocument()

    const nav = hostLink.closest('nav')
    if (!nav) throw new Error('nav not found')
    const linkTexts = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)
    expect(linkTexts.indexOf('Back to App')).toBeGreaterThan(linkTexts.indexOf('Post'))
  })
})

describe('NavLink public API (ADR-0021)', () => {
  it('renders without an `active` prop as inactive', () => {
    render(<NavLink href="/app">Back to App</NavLink>)
    const link = screen.getByRole('link', { name: 'Back to App' })
    expect(link).not.toHaveAttribute('aria-current')
    expect(link).not.toHaveAttribute('data-active')
  })

  it('renders without an `icon` prop, keeping the label aligned via the reserved icon box', () => {
    render(<NavLink href="/app">Back to App</NavLink>)
    const link = screen.getByRole('link', { name: 'Back to App' })
    const iconBox = link.querySelector('span[aria-hidden="true"]')
    expect(iconBox).toBeInTheDocument()
  })

  it('keeps the data-slot="nav-link" handle', () => {
    render(<NavLink href="/app">Back to App</NavLink>)
    const link = screen.getByRole('link', { name: 'Back to App' })
    expect(link).toHaveAttribute('data-slot', 'nav-link')
  })
})
