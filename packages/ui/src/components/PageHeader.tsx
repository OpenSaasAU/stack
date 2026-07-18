import * as React from 'react'
import Link from 'next/link.js'
import { cn } from '../lib/utils.js'

/**
 * Per-part `classNames` slots for `PageHeader`. Each merges onto its
 * `data-slot` part via `cn`/tailwind-merge so caller classes win.
 */
export interface PageHeaderClassNames {
  /** Outer wrapper (`data-slot="page-header"`). */
  root?: string
  /** The back link, when `backHref` is set (`data-slot="page-header-back"`). */
  back?: string
  /** The row holding the title block and actions (`data-slot="page-header-row"`). */
  row?: string
  /** The `<h1>` title (`data-slot="page-header-title"`). */
  title?: string
  /** The description paragraph (`data-slot="page-header-description"`). */
  description?: string
  /** The actions container (`data-slot="page-header-actions"`). */
  actions?: string
}

export interface PageHeaderProps {
  /** The screen title, rendered as the page `<h1>`. */
  title: React.ReactNode
  /** Optional leading icon shown beside the title (token-colored). */
  icon?: React.ReactNode
  /** Optional supporting copy shown beneath the title. */
  description?: React.ReactNode
  /** Optional trailing actions (e.g. a "Create" button), right-aligned. */
  actions?: React.ReactNode
  /** Optional back link shown above the title. */
  backHref?: string
  /** Back-link label. @default 'Back' */
  backLabel?: React.ReactNode
  /**
   * When set, frames the header with the signature gradient accent. Reserved for
   * the dashboard — the spec limits gradient to a few signature moments, so this
   * should not be enabled on ordinary list/item screens.
   */
  gradient?: boolean
  /** Merged onto the outer wrapper. */
  className?: string
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: PageHeaderClassNames
}

/**
 * Consistent page-header pattern shared by the dashboard, list, item, and
 * singleton screens (issue #710). Renders an optional back link, a heading, a
 * muted description, and a trailing actions slot. Every part carries a stable
 * `data-slot` and merges a `classNames` slot so the header can be restyled per
 * instance or globally with plain CSS.
 *
 * Server-safe (no client hooks) so it can be rendered inside the async admin
 * screen components.
 */
export function PageHeader({
  title,
  icon,
  description,
  actions,
  backHref,
  backLabel = 'Back',
  gradient = false,
  className,
  classNames,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        'mb-8',
        gradient &&
          'relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-gradient-from/10 to-gradient-to/10 p-6',
        className,
        classNames?.root,
      )}
    >
      {backHref && (
        <Link
          href={backHref}
          data-slot="page-header-back"
          className={cn(
            'mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground',
            classNames?.back,
          )}
        >
          <svg
            className="mr-1 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          {backLabel}
        </Link>
      )}
      <div
        data-slot="page-header-row"
        className={cn(
          'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between',
          classNames?.row,
        )}
      >
        <div className="min-w-0">
          <h1
            data-slot="page-header-title"
            className={cn(
              'flex items-center gap-2.5 font-heading text-3xl font-bold tracking-tight text-foreground',
              classNames?.title,
            )}
          >
            {icon && (
              <span
                data-slot="page-header-icon"
                aria-hidden="true"
                className="flex shrink-0 items-center text-primary [&_svg]:h-7 [&_svg]:w-7"
              >
                {icon}
              </span>
            )}
            {title}
          </h1>
          {description && (
            <p
              data-slot="page-header-description"
              className={cn('mt-1 text-muted-foreground', classNames?.description)}
            >
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div
            data-slot="page-header-actions"
            className={cn('flex shrink-0 items-center gap-2', classNames?.actions)}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
