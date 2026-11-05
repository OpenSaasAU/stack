'use client'

import { useEffect, useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation.js'
import { Button } from '../primitives/button.js'
import { ThemeToggle } from './ThemeToggle.js'

export interface UserMenuProps {
  userName?: string
  userEmail?: string
  /**
   * Ends the session, and should `redirect()` to the app's sign-in page, which
   * is what keeps Next's `basePath`. If it returns without redirecting the page
   * reloads, so the app's own guard decides what to show. On a rejection the menu
   * stays put and warns the user. Without it no Sign Out control renders.
   */
  onSignOut?: () => Promise<void>
}

export function UserMenu({ userName, userEmail, onSignOut }: UserMenuProps) {
  const [isSigningOut, startSignOut] = useTransition()
  const [signOutFailed, setSignOutFailed] = useState(false)

  // A document the browser froze in its back-forward cache still shows this user
  // after they sign out, so a restored page has to ask the server again.
  useEffect(() => {
    const reloadIfRestored = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload()
    }
    window.addEventListener('pageshow', reloadIfRestored)
    return () => window.removeEventListener('pageshow', reloadIfRestored)
  }, [])

  return (
    <div className="border-t border-border p-4">
      <div className="mb-3 flex items-center space-x-3">
        {/* Avatar fallback uses the signature gradient pair (an allowed
            signature moment per the spec) — the rest of the menu is restrained. */}
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-gradient-from to-gradient-to shadow-sm">
          <span className="text-sm font-bold text-primary-foreground">
            {userName?.[0]?.toUpperCase() || '?'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{userName || 'User'}</p>
          <p className="text-xs text-muted-foreground truncate">{userEmail || ''}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle className="flex-1 justify-start" />
        {onSignOut && (
          <Button
            onClick={() =>
              startSignOut(async () => {
                setSignOutFailed(false)
                try {
                  await onSignOut()
                } catch (error) {
                  unstable_rethrow(error)
                  setSignOutFailed(true)
                  return
                }
                // Not router.push: Next's client cache would hand the signed-in admin
                // back on Back. Not a path either: it would skip Next's basePath.
                window.location.reload()
              })
            }
            disabled={isSigningOut}
            variant="outline"
            size="sm"
            className="flex-1 text-sm"
          >
            Sign Out
          </Button>
        )}
      </div>
      {signOutFailed && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          Sign out may not have completed.
        </p>
      )}
    </div>
  )
}
