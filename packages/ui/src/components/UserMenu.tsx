'use client'

import { useRouter } from 'next/navigation.js'
import { Button } from '../primitives/button.js'
import { ThemeToggle } from './ThemeToggle.js'

export interface UserMenuProps {
  userName?: string
  userEmail?: string
  onSignOut?: () => Promise<void>
}

/**
 * User menu component with sign-out button
 * Client Component
 */
export function UserMenu({ userName, userEmail, onSignOut }: UserMenuProps) {
  const router = useRouter()

  const handleSignOut = async () => {
    if (onSignOut) {
      await onSignOut()
    }
    router.push('/sign-in')
  }
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
        <Button onClick={handleSignOut} variant="outline" size="sm" className="flex-1 text-sm">
          Sign Out
        </Button>
      </div>
    </div>
  )
}
