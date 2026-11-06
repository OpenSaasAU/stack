import * as React from 'react'

const MAIN_ID = 'admin-main'

export interface AdminFrameProps {
  /** Contents of the top bar shown below `md`. Without it there is no bar. */
  topBar?: React.ReactNode
  /** The sidebar, in the page flow from `md` up. */
  sidebar?: React.ReactNode
  children: React.ReactNode
}

/**
 * The page frame the admin and its loading state share. It has no hooks, so a
 * route's `loading.tsx` can render it on the server.
 */
export function AdminFrame({ topBar, sidebar, children }: AdminFrameProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <a
        href={`#${MAIN_ID}`}
        data-slot="admin-skip-link"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      {topBar && (
        <header
          data-slot="admin-topbar"
          className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-card px-2 md:hidden"
        >
          {topBar}
        </header>
      )}
      <div className="hidden md:contents">{sidebar}</div>
      {/* The margin clears the top bar and a field's label when the browser scrolls a
          focused control into view, which it otherwise leaves under the sticky bar. */}
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="flex-1 overflow-y-auto outline-none max-md:**:scroll-mt-24"
      >
        {children}
      </main>
    </div>
  )
}
