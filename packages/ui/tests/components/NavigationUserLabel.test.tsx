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

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const config: OpenSaasConfig = {
  db: { provider: 'sqlite', url: 'file:./test.db' },
  lists: { Post: list({ fields: { title: text() } }) },
}

function contextWithSession(session: Record<string, unknown>): AccessContext {
  return {
    db: {},
    session,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  } as unknown as AccessContext
}

describe('Navigation user label', () => {
  it('never renders the literal string "undefined" when sessionFields carries no name/email', () => {
    // The session's shape is user-defined (`sessionFields` is configurable) —
    // this session carries only `userId`, as a real app's might.
    render(
      <Navigation
        context={contextWithSession({ userId: 'user-1' })}
        config={config}
        basePath="/admin"
      />,
    )

    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
    expect(screen.getByText('User')).toBeInTheDocument()
  })

  it('renders the session name and email when present', () => {
    render(
      <Navigation
        context={contextWithSession({
          userId: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        })}
        config={config}
        basePath="/admin"
      />,
    )

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
  })
})
