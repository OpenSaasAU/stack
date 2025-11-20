'use client'

import { useRouter } from 'next/navigation.js'
import { Button } from '../primitives/button.js'

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
    <div className="p-4 border-t border-border bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="flex items-center space-x-3 mb-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/25">
          <span className="text-sm font-bold text-primary-foreground">
            {userName?.[0]?.toUpperCase() || '?'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{userName || 'User'}</p>
          <p className="text-xs text-muted-foreground truncate">{userEmail || ''}</p>
        </div>
      </div>
      <Button
        onClick={handleSignOut}
        variant="outline"
        size="sm"
        className="w-full text-sm"
      >
        Sign Out
      </Button>
    </div>
  )
}
