import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminShell } from '../../src/components/AdminShell.js'

const navigation = vi.hoisted(() => ({ pathname: '/admin' }))

vi.mock('next/navigation.js', () => ({
  usePathname: () => navigation.pathname,
}))

const sidebar = (
  <nav aria-label="Sidebar">
    <a href="/admin/post">Posts</a>
    <a href="#group">Toggle group</a>
    <a href="/docs" target="_blank" rel="noreferrer" onClick={(event) => event.preventDefault()}>
      Docs
    </a>
    <button type="button">Theme</button>
  </nav>
)

function renderShell() {
  return render(<AdminShell sidebar={sidebar}>Page</AdminShell>)
}

const menuButton = () => screen.getByRole('button', { name: 'Open navigation', hidden: true })
const drawer = () => screen.queryByRole('dialog', { name: 'Navigation' })

async function openDrawer() {
  await userEvent.click(menuButton())
  const dialog = drawer()
  if (!dialog) throw new Error('drawer did not open')
  return dialog
}

describe('AdminShell', () => {
  beforeEach(() => {
    navigation.pathname = '/admin'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mounts the sidebar once while the drawer is closed, behind a CSS-only switch', () => {
    renderShell()

    expect(screen.getAllByRole('navigation', { name: 'Sidebar' })).toHaveLength(1)
    expect(drawer()).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Sidebar' }).parentElement).toHaveClass(
      'hidden',
      'md:contents',
    )
    expect(screen.getByRole('banner')).toHaveClass('md:hidden')
  })

  it('opens from the keyboard and returns focus when Escape closes it', async () => {
    renderShell()

    menuButton().focus()
    await userEvent.keyboard('{Enter}')

    const dialog = drawer()
    if (!dialog) throw new Error('drawer did not open')
    expect(within(dialog).getByRole('link', { name: 'Posts' })).toBeInTheDocument()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    await userEvent.keyboard('{Escape}')

    expect(drawer()).toBeNull()
    await waitFor(() => expect(menuButton()).toHaveFocus())
  })

  it('closes when a link in it is followed, even one to the current page', async () => {
    navigation.pathname = '/admin/post'
    renderShell()
    const dialog = await openDrawer()

    await userEvent.click(within(dialog).getByRole('link', { name: 'Posts' }))

    expect(drawer()).toBeNull()
  })

  it.each(['Toggle group', 'Docs'])(
    'stays open for %s, which leaves this tab where it is',
    async (name) => {
      renderShell()
      const dialog = await openDrawer()

      await userEvent.click(within(dialog).getByRole('link', { name }))

      expect(drawer()).not.toBeNull()
    },
  )

  it('puts focus on the first link when it opens', async () => {
    renderShell()
    const dialog = await openDrawer()

    await waitFor(() => expect(within(dialog).getByRole('link', { name: 'Posts' })).toHaveFocus())
  })

  it('offers no menu when there is no navigation to show', () => {
    render(<AdminShell sidebar={false}>Page</AdminShell>)

    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.getByRole('main')).toHaveTextContent('Page')
  })

  it('stays open for a control in it that is not a link', async () => {
    renderShell()
    const dialog = await openDrawer()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Theme' }))

    expect(drawer()).not.toBeNull()
  })

  it('closes when the route changes under it', async () => {
    const { rerender } = renderShell()
    await openDrawer()

    navigation.pathname = '/admin/post'
    rerender(<AdminShell sidebar={sidebar}>Page</AdminShell>)

    expect(drawer()).toBeNull()
  })

  it('closes on a history traversal that leaves the pathname alone', async () => {
    renderShell()
    await openDrawer()

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(drawer()).toBeNull()
  })

  it('closes when the window grows past the breakpoint', async () => {
    const desktop = window.matchMedia('(min-width: 48rem)')
    vi.spyOn(window, 'matchMedia').mockReturnValue(desktop)
    renderShell()
    await openDrawer()

    act(() => {
      desktop.dispatchEvent(new Event('change'))
    })

    expect(drawer()).toBeNull()
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)')
  })
})
