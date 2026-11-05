import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import type * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { redirect } from 'next/navigation.js'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { Navigation } from '../../src/components/Navigation.js'
import { UserMenu } from '../../src/components/UserMenu.js'

const reload = vi.fn()

vi.mock('next/link.js', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('UserMenu sign out', () => {
  beforeEach(() => {
    reload.mockClear()
    vi.stubGlobal('location', { ...window.location, reload })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders no Sign Out control without a handler, and keeps the rest of the menu', () => {
    render(<UserMenu userName="Ada" userEmail="ada@example.com" />)

    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull()
    expect(screen.getByText('ada@example.com')).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('reloads the document only after a handler that did not redirect has resolved', async () => {
    let finishSignOut = () => {}
    const onSignOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSignOut = resolve
        }),
    )
    render(<UserMenu userName="Ada" onSignOut={onSignOut} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()

    finishSignOut()

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it('cannot be clicked twice while signing out', async () => {
    const onSignOut = vi.fn(() => new Promise<void>(() => {}))
    render(<UserMenu userName="Ada" onSignOut={onSignOut} />)
    const button = screen.getByRole('button', { name: 'Sign Out' })

    await userEvent.click(button)
    await userEvent.click(button)

    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('stays put and says so when the handler rejects', async () => {
    render(
      <UserMenu userName="Ada" onSignOut={() => Promise.reject(new Error('session still live'))} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Sign out may not have completed.')
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not report a redirect from the handler as a failure', async () => {
    const onSignOut = async () => redirect('/goodbye')
    render(<UserMenu userName="Ada" onSignOut={onSignOut} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await new Promise((resolve) => setTimeout(resolve))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('UserMenu back-forward cache', () => {
  beforeEach(() => {
    reload.mockClear()
    vi.stubGlobal('location', { ...window.location, reload })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reloads a page restored from the cache, and no other', () => {
    render(<UserMenu userName="Ada" />)

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    expect(reload).not.toHaveBeenCalled()

    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('Navigation sign out', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { ...window.location, reload })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const config: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }
  const context = {
    db: {},
    session: { userId: 'u1', name: 'Ada', email: 'ada@example.com' },
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  } as unknown as AccessContext

  it('shows a signed-in user no Sign Out control when the app passed no handler', () => {
    render(<Navigation context={context} config={config} />)

    expect(screen.getByText('ada@example.com')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull()
  })

  it('forwards the handler to the menu', async () => {
    const onSignOut = vi.fn(() => Promise.resolve())
    render(<Navigation context={context} config={config} onSignOut={onSignOut} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
