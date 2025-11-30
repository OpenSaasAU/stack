import Link from 'next/link.js'
import { formatListName } from '../lib/utils.js'
import { type AccessContext, getUrlKey, OpenSaasConfig } from '@opensaas/stack-core'
import { UserMenu } from './UserMenu.js'

export interface NavigationProps {
  context: AccessContext<unknown>
  config: OpenSaasConfig
  basePath?: string
  currentPath?: string
  onSignOut?: () => Promise<void>
}

/**
 * Navigation sidebar showing all lists
 * Server Component
 */
export function Navigation({
  context,
  config,
  basePath = '/admin',
  currentPath = '',
  onSignOut,
}: NavigationProps) {
  const lists = Object.keys(config.lists || {})

  return (
    <nav className="w-64 border-r border-border bg-card h-screen sticky top-0 flex flex-col">
      {/* Header with gradient */}
      <div className="p-6 border-b border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/10 opacity-50" />
        <Link href={basePath} className="block relative">
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            OpenSaas Admin
          </h1>
        </Link>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          <Link
            href={basePath}
            className={`block px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative overflow-hidden group ${
              currentPath === ''
                ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25'
                : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground'
            }`}
          >
            {currentPath === '' && (
              <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 animate-pulse" />
            )}
            <span className="relative flex items-center gap-2">
              <span className={currentPath === '' ? 'text-lg' : 'text-base'}>📊</span>
              Dashboard
            </span>
          </Link>

          {lists.length > 0 && (
            <>
              <div className="pt-4 pb-2 px-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Lists
                </p>
              </div>
              {lists.map((listKey) => {
                const urlKey = getUrlKey(listKey)
                const isActive = currentPath.startsWith(`/${urlKey}`)
                return (
                  <Link
                    key={listKey}
                    href={`${basePath}/${urlKey}`}
                    className={`block px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative overflow-hidden group ${
                      isActive
                        ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25'
                        : 'text-foreground hover:bg-accent/50 hover:text-accent-foreground'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 animate-pulse" />
                    )}
                    <span className="relative flex items-center gap-2">
                      <span className="opacity-60 group-hover:opacity-100 transition-opacity">
                        📁
                      </span>
                      {formatListName(listKey)}
                    </span>
                  </Link>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* Footer - User Menu */}
      {context.session && (
        <UserMenu
          userName={String((context.session.data as Record<string, unknown>)?.name) || 'User'}
          userEmail={String((context.session.data as Record<string, unknown>)?.email) || ''}
          onSignOut={onSignOut}
        />
      )}
    </nav>
  )
}
