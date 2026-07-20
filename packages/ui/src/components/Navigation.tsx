import * as React from 'react'
import Link from 'next/link.js'
import { LayoutDashboard, List, Settings } from 'lucide-react'
import { cn, formatListName } from '../lib/utils.js'
import { type AccessContext, getUrlKey, OpenSaasConfig } from '@opensaas/stack-core'
import { Badge } from '../primitives/badge.js'
import { UserMenu } from './UserMenu.js'
import { ThemeToggle } from './ThemeToggle.js'

export interface NavigationProps {
  context: AccessContext<unknown>
  config: OpenSaasConfig
  basePath?: string
  currentPath?: string
  onSignOut?: () => Promise<void>
  /**
   * Access-scoped record counts to show next to opted-in list nav items (issue
   * #735), keyed by list key. Resolved upstream (by `AdminUI` via
   * `resolveNavCounts`) so this presentational chrome stays synchronous. Only
   * lists present in this map show a count; a list that didn't opt in — or whose
   * query access is statically denied — is simply absent and renders no badge.
   */
  navCounts?: Record<string, number>
}

/**
 * A single sidebar navigation link. Active links use a solid brand fill and
 * carry `aria-current="page"` (the accessible, testable active-state signal);
 * gradients are deliberately NOT used here — the spec limits them to a few
 * signature moments, so active nav is a quiet solid fill, not a glow.
 */
function NavLink({
  href,
  active,
  icon,
  count,
  children,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  /**
   * Optional access-scoped record count shown as a trailing badge (issue #735).
   * `undefined` renders no badge; `0` renders a "0" badge (the list opted in and
   * the session can see none — distinct from a list that didn't opt in).
   */
  count?: number
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      data-slot="nav-link"
      data-active={active ? '' : undefined}
      className={cn(
        'group flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 items-center justify-center transition-opacity',
          active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100',
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="truncate">{children}</span>
      {count !== undefined && (
        <Badge
          data-slot="nav-count"
          variant={active ? 'outline' : 'secondary'}
          className="ml-auto tabular-nums"
        >
          {count}
        </Badge>
      )}
    </Link>
  )
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
  navCounts,
}: NavigationProps) {
  const allLists = Object.keys(config.lists || {})
  // Split lists into standard lists (under "Lists") and singletons (under
  // "Settings"). A singleton edits a single record, so it belongs in a distinct
  // Settings group rather than the standard list grid.
  const lists = allLists.filter((listKey) => !config.lists[listKey]?.isSingleton)
  const singletons = allLists.filter((listKey) => config.lists[listKey]?.isSingleton)

  return (
    <nav className="sticky top-0 flex h-screen w-64 flex-col border-r border-border bg-card">
      {/* Header — a restrained solid wordmark. The gradient pair is reserved for
          the dashboard signature moment, so the brand text stays a solid token. */}
      <div className="border-b border-border p-6">
        <Link href={basePath} className="block">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">
            OpenSaas Admin
          </h1>
        </Link>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          <NavLink
            href={basePath}
            active={currentPath === ''}
            icon={<LayoutDashboard className="h-4 w-4" />}
          >
            Dashboard
          </NavLink>

          {lists.length > 0 && (
            <>
              <div className="px-3 pb-2 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lists
                </p>
              </div>
              {lists.map((listKey) => {
                const urlKey = getUrlKey(listKey)
                return (
                  <NavLink
                    key={listKey}
                    href={`${basePath}/${urlKey}`}
                    active={currentPath.startsWith(`/${urlKey}`)}
                    icon={<List className="h-4 w-4" />}
                    count={navCounts?.[listKey]}
                  >
                    {formatListName(listKey)}
                  </NavLink>
                )
              })}
            </>
          )}

          {singletons.length > 0 && (
            <>
              <div className="px-3 pb-2 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Settings
                </p>
              </div>
              {singletons.map((listKey) => {
                const urlKey = getUrlKey(listKey)
                return (
                  <NavLink
                    key={listKey}
                    href={`${basePath}/${urlKey}`}
                    active={currentPath.startsWith(`/${urlKey}`)}
                    icon={<Settings className="h-4 w-4" />}
                  >
                    {formatListName(listKey)}
                  </NavLink>
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
        <div className="flex justify-end border-t border-border p-4">
          <ThemeToggle />
        </div>
      )}
    </nav>
  )
}
