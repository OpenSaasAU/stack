'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation.js'
import { Menu } from 'lucide-react'
import { Button } from '../primitives/button.js'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../primitives/dialog.js'
import { AdminFrame } from './AdminFrame.js'

// Tailwind's `md` breakpoint. The markup switches on it in CSS; this only tells
// an open drawer that the window has grown past it.
const DESKTOP_QUERY = '(min-width: 48rem)'

function navigatesThisTab(target: EventTarget): boolean {
  if (!(target instanceof Element)) return false
  const link = target.closest('a[href]')
  if (!link) return false
  return !link.getAttribute('href')?.startsWith('#') && link.getAttribute('target') !== '_blank'
}

export interface AdminShellProps {
  /** Shown in the top bar beside the menu button. */
  brand?: React.ReactNode
  /** The sidebar: in the page flow from `md` up, in a drawer below it. */
  sidebar: React.ReactNode
  children: React.ReactNode
}

/**
 * The admin's page frame with its navigation behaviour. `sidebar` is mounted in
 * the page flow, where `md:contents` leaves it a direct flex child of the frame,
 * and again in a drawer only while that is open. Which one shows is decided in
 * CSS, so the server and the first client render agree at any width.
 */
export function AdminShell({ brand, sidebar, children }: AdminShellProps) {
  const pathname = usePathname()
  const [openedOn, setOpenedOn] = React.useState<string | null>(null)
  const open = openedOn !== null && openedOn === pathname

  React.useEffect(() => {
    if (!open) return
    const close = () => setOpenedOn(null)
    const desktop = window.matchMedia(DESKTOP_QUERY)
    desktop.addEventListener('change', close)
    // Going back to the same pathname under a different query moves no `pathname`.
    window.addEventListener('popstate', close)
    return () => {
      desktop.removeEventListener('change', close)
      window.removeEventListener('popstate', close)
    }
  }, [open])

  const hasTopBar = Boolean(sidebar)
  React.useEffect(() => {
    if (!hasTopBar) return
    // Focusing a text surface scrolls its caret into view, not the element, and the
    // caret is out of reach of the `scroll-margin` that keeps inputs clear of the bar.
    const revealTextSurface = ({ target }: FocusEvent) => {
      if (window.matchMedia(DESKTOP_QUERY).matches || !(target instanceof Element)) return
      if (target.matches('main textarea, main [contenteditable]')) {
        target.scrollIntoView({ block: 'nearest' })
      }
    }
    document.addEventListener('focusin', revealTextSurface)
    return () => document.removeEventListener('focusin', revealTextSurface)
  }, [hasTopBar])

  if (!sidebar) return <AdminFrame>{children}</AdminFrame>

  return (
    <Dialog open={open} onOpenChange={(next) => setOpenedOn(next ? pathname : null)}>
      <AdminFrame
        sidebar={sidebar}
        topBar={
          <>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-slot="admin-menu-button"
                aria-label="Open navigation"
                className="h-11 w-11 shrink-0"
              >
                <Menu aria-hidden="true" />
              </Button>
            </DialogTrigger>
            {brand}
          </>
        }
      >
        {children}
      </AdminFrame>

      <DialogContent
        data-slot="admin-nav-drawer"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Radix skips links when it picks the first tabbable, which lands on the
          // theme toggle at the bottom of the sidebar.
          if (!(event.currentTarget instanceof Element)) return
          const firstLink = event.currentTarget.querySelector<HTMLElement>('a[href]')
          if (!firstLink) return
          event.preventDefault()
          firstLink.focus()
        }}
        onClick={(event) => {
          if (navigatesThisTab(event.target)) setOpenedOn(null)
        }}
        className="left-0 top-0 block h-dvh max-w-[calc(100vw-3rem)] min-w-64 translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 bg-card p-0 max-md:max-h-none max-md:w-max"
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        {sidebar}
      </DialogContent>
    </Dialog>
  )
}
