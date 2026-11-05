'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation.js'
import { Menu } from 'lucide-react'
import { Button } from '../primitives/button.js'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../primitives/dialog.js'

// Tailwind's `md` breakpoint. The markup switches on it in CSS; this only tells
// an open drawer that the window has grown past it.
const DESKTOP_QUERY = '(min-width: 48rem)'

export interface AdminShellProps {
  /** Shown in the top bar beside the menu button. */
  brand?: React.ReactNode
  /** The sidebar: in the page flow from `md` up, in a drawer below it. */
  sidebar: React.ReactNode
  children: React.ReactNode
}

/**
 * The admin's page frame. `sidebar` is mounted in the page flow, where
 * `md:contents` leaves it a direct flex child of the frame, and again in a drawer
 * only while that is open. Which one shows is decided in CSS, so the server and
 * the first client render agree at any width.
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

  return (
    <Dialog open={open} onOpenChange={(next) => setOpenedOn(next ? pathname : null)}>
      <div className="flex min-h-dvh flex-col bg-background md:flex-row">
        <header
          data-slot="admin-topbar"
          className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-card px-2 md:hidden"
        >
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
        </header>
        <div className="hidden md:contents">{sidebar}</div>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <DialogContent
        data-slot="admin-nav-drawer"
        aria-describedby={undefined}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) {
            setOpenedOn(null)
          }
        }}
        className="left-0 top-0 block h-dvh max-h-none w-max min-w-64 max-w-[calc(100vw-3rem)] translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 bg-card p-0"
      >
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        {sidebar}
      </DialogContent>
    </Dialog>
  )
}
