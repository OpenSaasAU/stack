import Link from 'next/link.js'
import { formatListName } from '../lib/utils.js'
import { type AccessContext, getDbKey, getUrlKey, OpenSaasConfig } from '@opensaas/stack-core'
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card.js'

export interface DashboardProps {
  context: AccessContext<unknown>
  config: OpenSaasConfig
  basePath?: string
}

/**
 * Dashboard landing page showing all available lists
 * Server Component
 */
export async function Dashboard({ context, config, basePath = '/admin' }: DashboardProps) {
  const lists = Object.keys(config.lists || {})

  // Split lists into standard lists (shown in the counted grid) and singletons
  // (shown in their own "Settings" section). A singleton's count is always 0/1,
  // so the "N items" label is misleading — show a "Configure" affordance instead.
  const standardLists = lists.filter((listKey) => !config.lists[listKey]?.isSingleton)
  const singletonLists = lists.filter((listKey) => config.lists[listKey]?.isSingleton)

  // Get counts for the standard lists only. Singletons don't show a count, so
  // there's no need to call count() for them here.
  const listCounts = await Promise.all(
    standardLists.map(async (listKey) => {
      try {
        const delegate = context.db[getDbKey(listKey)]
        const count = delegate?.count ? await delegate.count() : 0
        return { listKey, count }
      } catch (error) {
        console.error(`Failed to get count for ${listKey}:`, error)
        return { listKey, count: 0 }
      }
    }),
  )

  return (
    <div className="p-8">
      {/* Header with gradient */}
      <div className="mb-8 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-accent/5 opacity-100 rounded-2xl" />
        <div className="relative p-6">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Dashboard
          </h1>
          <p className="text-muted-foreground">Manage your application data</p>
        </div>
      </div>

      {lists.length === 0 ? (
        <Card className="p-12 text-center border-2 border-dashed">
          <div className="mb-4 text-4xl">📦</div>
          <p className="text-muted-foreground mb-2 font-medium">No lists configured</p>
          <p className="text-sm text-muted-foreground">
            Add lists to your opensaas.config.ts to get started.
          </p>
        </Card>
      ) : standardLists.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {listCounts.map(({ listKey, count }) => {
            const urlKey = getUrlKey(listKey)
            return (
              <Link key={listKey} href={`${basePath}/${urlKey}`}>
                <Card className="group hover:border-primary hover:shadow-lg hover:shadow-primary/20 transition-all duration-200 cursor-pointer h-full relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <CardHeader className="relative">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl group-hover:text-primary transition-colors">
                          {formatListName(listKey)}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1 font-medium">
                          {count} {count === 1 ? 'item' : 'items'}
                        </p>
                      </div>
                      <div className="text-3xl opacity-60 group-hover:opacity-100 transition-opacity">
                        📋
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="relative">
                    <div className="flex items-center text-sm font-medium text-primary">
                      <span>View all</span>
                      <svg
                        className="ml-1 w-4 h-4 group-hover:translate-x-1 transition-transform"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : null}

      {/* Settings section — singletons present a "Configure" affordance instead
          of a misleading "N items" count. */}
      {singletonLists.length > 0 && (
        <div className={standardLists.length > 0 ? 'mt-12' : ''}>
          <div className="mb-4 flex items-center gap-2">
            <svg
              className="w-5 h-5 text-muted-foreground"
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
            <h2 className="text-xl font-semibold text-foreground">Settings</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {singletonLists.map((listKey) => {
              const urlKey = getUrlKey(listKey)
              return (
                <Link key={listKey} href={`${basePath}/${urlKey}`}>
                  <Card className="group hover:border-primary hover:shadow-lg hover:shadow-primary/20 transition-all duration-200 cursor-pointer h-full relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="relative">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-xl group-hover:text-primary transition-colors">
                            {formatListName(listKey)}
                          </CardTitle>
                        </div>
                        <div className="text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity">
                          <svg
                            className="w-7 h-7"
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
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="relative">
                      <div className="flex items-center text-sm font-medium text-primary">
                        <span>Configure</span>
                        <svg
                          className="ml-1 w-4 h-4 group-hover:translate-x-1 transition-transform"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick Actions only contains "Create {list}" links for standard lists,
          so hide the whole card when there are no standard lists (e.g. a
          singleton-only admin). */}
      {standardLists.length > 0 && (
        <Card className="mt-12 bg-gradient-to-br from-accent/10 to-primary/10 border-accent/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="text-xl">⚡</span>
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {/* Singletons have a single record (no create), so they're
                  excluded here — only standard lists get a "Create" quick-action. */}
              {standardLists.map((listKey) => {
                const urlKey = getUrlKey(listKey)
                return (
                  <Link
                    key={listKey}
                    href={`${basePath}/${urlKey}/create`}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground font-medium text-sm transition-colors border border-primary/20"
                  >
                    <span className="text-lg">+</span>
                    Create {formatListName(listKey)}
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
