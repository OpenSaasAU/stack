'use client'

import { useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation.js'
import { Button } from '../primitives/button.js'
import { ThemeToggle } from './ThemeToggle.js'

export interface UserMenuProps {
  userName?: string
  userEmail?: string
  /**
   * Ends the session, then the menu navigates to `/sign-in`. Without it no Sign
   * Out control renders. On a rejection the menu stays put and says the user is
   * still signed in; a `redirect()` from the action is followed as usual.
   */
  onSignOut?: () => Promise<void>
}

export function UserMenu({ userName, userEmail, onSignOut }: UserMenuProps) {
  const [isSigningOut, startSignOut] = useTransition()
  const [signOutFailed, setSignOutFailed] = useState(false)

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
                // A document navigation, not router.push: Next's client cache would
                // otherwise hand the signed-in admin back on Back.
                window.location.assign('/sign-in')
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
          Sign out failed. You are still signed in.
        </p>
      )}
    </div>
  )
}
