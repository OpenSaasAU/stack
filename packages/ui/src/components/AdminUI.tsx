import * as React from 'react'
import { redirect } from 'next/navigation.js'
import { Navigation, NavLink } from './Navigation.js'
import { Dashboard } from './Dashboard.js'
import { ListView } from './ListView.js'
import { ItemForm } from './ItemForm.js'
import { SingletonView } from './SingletonView.js'
import { DashboardSkeleton, ItemFormSkeleton, ListViewSkeleton } from './SkeletonLoader.js'
import type { ServerActionInput } from '../server/types.js'
import {
  type AccessContext,
  getUrlKey,
  OpenSaasConfig,
  resolveListKeyFromUrl,
  resolveNavCounts,
} from '@opensaas/stack-core'
import { compileTheme } from '../lib/theme.js'
import { deriveCurrentPath } from '../lib/currentPath.js'

export interface AdminUIProps {
  context: AccessContext<unknown>
  config: OpenSaasConfig
  params?: string[]
  searchParams?: { [key: string]: string | string[] | undefined }
  basePath?: string
  // Server action can return any shape depending on the list item type
  serverAction: (input: ServerActionInput) => Promise<unknown>
  onSignOut?: () => Promise<void>
  /**
   * Replaces the built-in sidebar wholesale (ADR-0021, the "chrome slot").
   * `AdminUI` keeps routing, the shell, and theme compilation; it skips
   * `resolveNavCounts` when this is supplied, since host-owned chrome resolves
   * its own access-scoped counts. Takes precedence over `navItems` — if both
   * are supplied, `navigation` renders and `navItems` is ignored with a
   * development-only warning.
   */
  navigation?: React.ReactNode
  /**
   * Sugar over the built-in `Navigation`'s children region: one host-supplied
   * nav link per entry, rendered after the Lists and Settings groups and
   * above the footer. Ignored (with a dev-only warning) when `navigation` is
   * also supplied.
   */
  navItems?: Array<{ label: string; href: string; icon?: React.ReactNode }>
}

/**
 * Routes based on `params`:
 * - [] → Dashboard
 * - [list] → ListView (or SingletonView when the list is `isSingleton`)
 * - [list, 'create'] → ItemForm (create)
 * - [list, id] → ItemForm (edit)
 */
export async function AdminUI({
  context,
  config,
  params = [],
  searchParams = {},
  basePath = '/admin',
  serverAction,
  onSignOut,
  navigation,
  navItems,
}: AdminUIProps) {
  if (process.env.NODE_ENV !== 'production' && navigation && navItems) {
    console.warn(
      'AdminUI: both `navigation` and `navItems` were supplied. `navigation` takes precedence and `navItems` is ignored.',
    )
  }

  const [urlSegment, action] = params
  // Falls back to the raw segment when it resolves to no configured list, so
  // the existing "not found" branches below (which key off `config.lists`)
  // still render instead of silently taking the Dashboard/root path.
  const listKey = urlSegment
    ? (resolveListKeyFromUrl(urlSegment, Object.keys(config.lists)) ?? urlSegment)
    : undefined
  const currentPath = deriveCurrentPath(params)

  let content: React.ReactNode

  if (!listKey) {
    content = <Dashboard context={context} config={config} basePath={basePath} />
  } else if (config.lists[listKey]?.isSingleton && action) {
    // A singleton has a single record edited at its bare [list] route, so the
    // create/id sub-routes (`[list, 'create']` / `[list, id]`) don't apply.
    // Redirect them to the bare editor so old links keep working.
    redirect(`${basePath}/${getUrlKey(listKey)}`)
  } else if (action === 'create') {
    content = (
      <ItemForm
        context={context}
        config={config}
        listKey={listKey}
        mode="create"
        basePath={basePath}
        serverAction={serverAction}
      />
    )
  } else if (action && action !== 'create') {
    // `action` is the item ID here.
    content = (
      <ItemForm
        context={context}
        config={config}
        listKey={listKey}
        mode="edit"
        itemId={action}
        basePath={basePath}
        serverAction={serverAction}
      />
    )
  } else if (config.lists[listKey]?.isSingleton) {
    content = (
      <SingletonView
        context={context}
        config={config}
        listKey={listKey}
        basePath={basePath}
        serverAction={serverAction}
      />
    )
  } else {
    const search = typeof searchParams.search === 'string' ? searchParams.search : undefined
    const page = typeof searchParams.page === 'string' ? parseInt(searchParams.page, 10) : 1
    // Optional `?pageSize=` override (Keystone-style). When absent, ListView's
    // own default applies.
    const pageSizeParam =
      typeof searchParams.pageSize === 'string' ? parseInt(searchParams.pageSize, 10) : undefined
    const pageSize =
      pageSizeParam !== undefined && Number.isFinite(pageSizeParam) && pageSizeParam > 0
        ? pageSizeParam
        : undefined

    // Read list-view defaults (column selection/order + default sort) from the
    // list-level `ui.listView` config (mirrors Keystone). When absent, the
    // ListView falls back to its existing defaults (all non-system fields,
    // no default sort).
    const listView = config.lists[listKey]?.ui?.listView

    // Parse `?sort=field:direction` URL param for user-triggered column sorts.
    const sortParam = typeof searchParams.sort === 'string' ? searchParams.sort : undefined
    let urlSort: { field: string; direction: 'asc' | 'desc' } | undefined
    if (sortParam) {
      const colonIdx = sortParam.lastIndexOf(':')
      if (colonIdx > 0) {
        const field = sortParam.slice(0, colonIdx)
        const dir = sortParam.slice(colonIdx + 1)
        if (dir === 'asc' || dir === 'desc') {
          urlSort = { field, direction: dir }
        }
      }
    }

    content = (
      <ListView
        context={context}
        config={config}
        listKey={listKey}
        basePath={basePath}
        search={search}
        page={page}
        pageSize={pageSize}
        columns={listView?.initialColumns}
        initialSort={listView?.initialSort}
        sort={urlSort}
        serverAction={serverAction}
      />
    )
  }

  // Skeleton fallback matching the routed screen, so every data-loading screen
  // streams behind a placeholder of the same shape instead of a blank frame.
  let fallback: React.ReactNode
  if (!listKey) {
    fallback = <DashboardSkeleton />
  } else if (action || config.lists[listKey]?.isSingleton) {
    fallback = <ItemFormSkeleton />
  } else {
    fallback = <ListViewSkeleton />
  }

  const themeStyles = config.ui?.theme ? compileTheme(config.ui.theme) : null

  // Access-scoped nav counts for opted-in lists (issue #735). Zero queries when
  // no list sets `ui.navCount`; each count goes through the secured
  // `context.db`. Skipped when `navigation` is supplied — see that prop's doc
  // (ADR-0021).
  const navCounts = navigation ? undefined : await resolveNavCounts(context, config)

  const sidebar = navigation ?? (
    <Navigation
      context={context}
      config={config}
      basePath={basePath}
      currentPath={currentPath}
      onSignOut={onSignOut}
      navCounts={navCounts}
    >
      {navItems?.map((item) => (
        <NavLink key={item.href} href={item.href} icon={item.icon}>
          {item.label}
        </NavLink>
      ))}
    </Navigation>
  )

  return (
    <>
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      <div className="flex min-h-screen bg-background">
        {sidebar}
        <main className="flex-1 overflow-y-auto">
          <React.Suspense fallback={fallback}>{content}</React.Suspense>
        </main>
      </div>
    </>
  )
}
