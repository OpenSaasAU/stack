import Link from 'next/link.js'
import { formatListName } from '../lib/utils.js'
import { type AccessContext, getUrlKey, OpenSaasConfig } from '@opensaas/stack-core'
import { UserMenu } from './UserMenu.js'
import { ThemeToggle } from './ThemeToggle.js'

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
  const allLists = Object.keys(config.lists || {})
  // Split lists into standard lists (under "Lists") and singletons (under
  // "Settings"). A singleton edits a single record, so it belongs in a distinct
  // Settings group rather than the standard list grid.
  const lists = allLists.filter((listKey) => !config.lists[listKey]?.isSingleton)
  const singletons = allLists.filter((listKey) => config.lists[listKey]?.isSingleton)

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

          {singletons.length > 0 && (
            <>
              <div className="pt-4 pb-2 px-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Settings
                </p>
              </div>
              {singletons.map((listKey) => {
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
                      <svg
                        className="w-4 h-4 opacity-60 group-hover:opacity-100 transition-opacity"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      {formatListName(listKey)}
                    </span>
                  </Link>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* Footer - User Menu (authenticated) or a bare theme toggle (anonymous).
          The ThemeToggle lives in the user menu when signed in; when there is
          no session (e.g. the starter example) it still appears in the footer
          so the color-scheme control is always reachable. Custom chrome that
          builds its own Navigation opts out simply by not rendering it. */}
      {context.session ? (
        <UserMenu
          userName={String((context.session.data as Record<string, unknown>)?.name) || 'User'}
          userEmail={String((context.session.data as Record<string, unknown>)?.email) || ''}
          onSignOut={onSignOut}
        />
      ) : (
        <div className="p-4 border-t border-border flex justify-end">
          <ThemeToggle />
        </div>
      )}
    </nav>
  )
}
