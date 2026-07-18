import Link from 'next/link.js'
import { ArrowRight, LayoutDashboard, Package, Plus, Settings, Table2, Zap } from 'lucide-react'
import { formatListName } from '../lib/utils.js'
import { type AccessContext, getDbKey, getUrlKey, OpenSaasConfig } from '@opensaas/stack-core'
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card.js'
import { PageHeader } from './PageHeader.js'
import { EmptyState } from './EmptyState.js'

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
      {/* The dashboard header is the design system's one signature gradient
          moment in the chrome (spec: gradients as garnish, not sprinkled). */}
      <PageHeader
        title="Dashboard"
        icon={<LayoutDashboard />}
        description="Manage your application data"
        gradient
      />

      {lists.length === 0 ? (
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title="No lists configured"
          description="Add lists to your opensaas.config.ts to get started."
        />
      ) : standardLists.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {listCounts.map(({ listKey, count }) => {
            const urlKey = getUrlKey(listKey)
            return (
              <Link key={listKey} href={`${basePath}/${urlKey}`}>
                <Card className="group h-full cursor-pointer transition-colors duration-200 hover:border-primary hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl transition-colors group-hover:text-primary">
                          {formatListName(listKey)}
                        </CardTitle>
                        <p className="mt-1 text-sm font-medium tabular-nums text-muted-foreground">
                          {count} {count === 1 ? 'item' : 'items'}
                        </p>
                      </div>
                      <div className="text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 group-hover:text-primary">
                        <Table2 className="h-7 w-7" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center text-sm font-medium text-primary">
                      <span>View all</span>
                      <ArrowRight
                        className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1"
                        aria-hidden="true"
                      />
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
            <Settings className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-heading text-xl font-semibold text-foreground">Settings</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {singletonLists.map((listKey) => {
              const urlKey = getUrlKey(listKey)
              return (
                <Link key={listKey} href={`${basePath}/${urlKey}`}>
                  <Card className="group h-full cursor-pointer transition-colors duration-200 hover:border-primary hover:shadow-md">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-xl transition-colors group-hover:text-primary">
                            {formatListName(listKey)}
                          </CardTitle>
                        </div>
                        <div className="text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 group-hover:text-primary">
                          <Settings className="h-7 w-7" aria-hidden="true" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center text-sm font-medium text-primary">
                        <span>Configure</span>
                        <ArrowRight
                          className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1"
                          aria-hidden="true"
                        />
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
        <Card className="mt-12">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="h-5 w-5 text-primary" aria-hidden="true" />
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
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
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
