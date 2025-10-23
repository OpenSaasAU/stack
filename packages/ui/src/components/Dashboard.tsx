import Link from 'next/link'
import { formatListName } from '../lib/utils.js'
import { AccessContext, getDbKey, getUrlKey, OpenSaaSConfig } from '@opensaas/core'
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card.js'

export interface DashboardProps<TPrisma> {
  context: AccessContext<TPrisma>
  config: OpenSaaSConfig
  basePath?: string
}

/**
 * Dashboard landing page showing all available lists
 * Server Component
 */
export async function Dashboard<TPrisma>({
  context,
  config,
  basePath = '/admin',
}: DashboardProps<TPrisma>) {
  const lists = Object.keys(config.lists || {})

  // Get counts for each list
  const listCounts = await Promise.all(
    lists.map(async (listKey) => {
      try {
        const count = await context.db[getDbKey(listKey)]?.count()
        return { listKey, count: count || 0 }
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
        <div className="absolute inset-0 bg-gradient-to-r from-[hsl(var(--gradient-from))] to-[hsl(var(--gradient-to))] opacity-5 rounded-2xl" />
        <div className="relative p-6">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-[hsl(var(--gradient-from))] to-[hsl(var(--gradient-to))] bg-clip-text text-transparent">
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
      ) : (
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
      )}

      {lists.length > 0 && (
        <Card className="mt-12 bg-gradient-to-br from-accent/10 to-primary/10 border-accent/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="text-xl">⚡</span>
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {lists.map((listKey) => {
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
