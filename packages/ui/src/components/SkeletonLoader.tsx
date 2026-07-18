import { cn } from '../lib/utils.js'

export interface SkeletonLoaderProps {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
}

/**
 * Skeleton loader component for content placeholders
 */
export function SkeletonLoader({ className, variant = 'rectangular' }: SkeletonLoaderProps) {
  const variantClasses = {
    text: 'h-4 rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-md',
  }

  return (
    <div
      className={cn('animate-pulse bg-muted', variantClasses[variant], className)}
      aria-hidden="true"
    />
  )
}

/**
 * Table skeleton loader.
 *
 * Rendered as a purely presentational grid of `<div>`s (not a real `<table>`):
 * as a Suspense/`loading.tsx` fallback this can linger in Next.js's router cache
 * as a hidden segment, and a real `<table>` here would collide with any
 * `table`-role query against the loaded page (only the live data table, which
 * carries `data-slot="table"`, should match). The layout still mirrors a table
 * — a header row plus body rows of shimmer cells — so the loading state reads
 * the same while data streams in.
 */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div
      data-slot="table-skeleton"
      aria-hidden="true"
      className="bg-card border border-border rounded-lg overflow-hidden"
    >
      <div className="overflow-x-auto">
        <div className="min-w-full">
          <div className="bg-muted/50 border-b border-border flex">
            {Array.from({ length: columns }).map((_, i) => (
              <div key={i} className="flex-1 px-6 py-3">
                <SkeletonLoader variant="text" className="h-4 w-24" />
              </div>
            ))}
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <div key={rowIndex} className="flex">
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <div key={colIndex} className="flex-1 px-6 py-4">
                    <SkeletonLoader variant="text" className="h-4 w-32" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Form skeleton loader
 */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="space-y-6">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <SkeletonLoader variant="text" className="h-4 w-24" />
            <SkeletonLoader variant="rectangular" className="h-10 w-full" />
          </div>
        ))}
        <div className="flex items-center justify-between pt-6 border-t border-border">
          <div className="flex gap-3">
            <SkeletonLoader variant="rectangular" className="h-10 w-20" />
            <SkeletonLoader variant="rectangular" className="h-10 w-20" />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Page-header skeleton — mirrors the `PageHeader` layout (title + description,
 * optional trailing action) so a streaming screen reads as the same page while
 * its data loads.
 */
export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div data-slot="page-header-skeleton" className="mb-8 flex items-center justify-between">
      <div className="space-y-2">
        <SkeletonLoader variant="text" className="h-8 w-48" />
        <SkeletonLoader variant="text" className="h-4 w-32" />
      </div>
      {action && <SkeletonLoader variant="rectangular" className="h-10 w-36" />}
    </div>
  )
}

/**
 * Full list-screen skeleton — header + search bar + table. Used as the Suspense
 * fallback for the list view so every list data-load has skeleton coverage.
 */
export function ListViewSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div data-slot="list-view-skeleton" className="p-8">
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <SkeletonLoader variant="rectangular" className="h-16 w-full" />
        <TableSkeleton rows={rows} columns={columns} />
      </div>
    </div>
  )
}

/**
 * Full item-form skeleton — header + form. Used as the Suspense fallback for the
 * create/edit item screens.
 */
export function ItemFormSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div data-slot="item-form-skeleton" className="p-8 max-w-4xl">
      <PageHeaderSkeleton action={false} />
      <FormSkeleton fields={fields} />
    </div>
  )
}

/**
 * Full dashboard skeleton — header + a grid of card placeholders. Used as the
 * Suspense fallback for the dashboard while list counts are fetched.
 */
export function DashboardSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div data-slot="dashboard-skeleton" className="p-8">
      <PageHeaderSkeleton action={false} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-6 space-y-4">
            <div className="flex items-start justify-between">
              <SkeletonLoader variant="text" className="h-6 w-32" />
              <SkeletonLoader variant="circular" className="h-8 w-8" />
            </div>
            <SkeletonLoader variant="text" className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
