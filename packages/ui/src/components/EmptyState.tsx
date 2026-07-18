import * as React from 'react'
import { cn } from '../lib/utils.js'

/**
 * Per-part `classNames` slots for `EmptyState`. Each merges onto its
 * `data-slot` part via `cn`/tailwind-merge.
 */
export interface EmptyStateClassNames {
  /** Outer wrapper (`data-slot="empty-state"`). */
  root?: string
  /** The icon container (`data-slot="empty-state-icon"`). */
  icon?: string
  /** The title text (`data-slot="empty-state-title"`). */
  title?: string
  /** The description text (`data-slot="empty-state-description"`). */
  description?: string
  /** The actions container (`data-slot="empty-state-actions"`). */
  actions?: string
}

export interface EmptyStateProps {
  /** Optional decorative icon shown above the title. */
  icon?: React.ReactNode
  /** Short headline describing the empty surface. */
  title: React.ReactNode
  /** Optional supporting copy guiding the next step. */
  description?: React.ReactNode
  /** Optional call-to-action(s), e.g. a "Create" button. */
  actions?: React.ReactNode
  /** Merged onto the outer wrapper. */
  className?: string
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: EmptyStateClassNames
}

/**
 * Designed empty state shared by every list and relationship surface (issue
 * #710): a centered, dashed-border panel with an optional icon, a headline, a
 * muted description, and an optional action. Consumes tokens only (no hardcoded
 * colors) and exposes stable `data-slot` parts plus a `classNames` contract so
 * it can be restyled per instance.
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
  classNames,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center',
        className,
        classNames?.root,
      )}
    >
      {icon && (
        <div
          data-slot="empty-state-icon"
          aria-hidden="true"
          className={cn(
            'mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-2xl text-muted-foreground',
            classNames?.icon,
          )}
        >
          {icon}
        </div>
      )}
      <p
        data-slot="empty-state-title"
        className={cn('font-medium text-foreground', classNames?.title)}
      >
        {title}
      </p>
      {description && (
        <p
          data-slot="empty-state-description"
          className={cn('mt-1 max-w-sm text-sm text-muted-foreground', classNames?.description)}
        >
          {description}
        </p>
      )}
      {actions && (
        <div
          data-slot="empty-state-actions"
          className={cn('mt-6 flex items-center gap-2', classNames?.actions)}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
