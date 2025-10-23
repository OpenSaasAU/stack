import { TableSkeleton } from '@opensaas/ui'

/**
 * Loading UI for admin pages
 * Shows skeleton screens while content loads
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Navigation Skeleton */}
      <div className="w-64 border-r border-border bg-card p-6">
        <div className="mb-8">
          <div className="h-8 w-32 bg-muted animate-pulse rounded" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 w-full bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>

      {/* Main Content Skeleton */}
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-8">
          <div className="h-9 w-48 bg-muted animate-pulse rounded mb-2" />
          <div className="h-5 w-24 bg-muted animate-pulse rounded" />
        </div>
        <TableSkeleton rows={5} columns={4} />
      </main>
    </div>
  )
}
