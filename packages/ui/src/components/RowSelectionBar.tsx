'use client'

import * as React from 'react'
import { Button } from '../primitives/button.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { LoadingSpinner } from './LoadingSpinner.js'
import { cn } from '../lib/utils.js'

/**
 * Per-part `classNames` Slots for {@link RowSelectionBar}. Each merges onto its
 * `data-slot` part via `cn`/tailwind-merge, mirroring the other admin
 * components. Slot names are part of the reviewed API surface (renaming a
 * shipped Slot is a compatibility break).
 */
export interface RowSelectionBarClassNames {
  /** The bar container (`data-slot="selection-bar"`). */
  root?: string
  /** The "N selected" count (`data-slot="selection-count"`). */
  count?: string
  /** The Clear button (`data-slot="selection-clear"`). */
  clear?: string
  /** The custom-actions region (`data-slot="selection-actions"`). */
  actions?: string
  /** The built-in Delete button (`data-slot="selection-delete"`). */
  delete?: string
}

export interface RowSelectionBarProps {
  /** Number of selected rows; the bar renders nothing when this is 0. */
  count: number
  /** Clear the whole selection. */
  onClear: () => void
  /**
   * The built-in Bulk action Delete handler. When provided, a Delete button is
   * shown (behind a {@link ConfirmDialog}); when omitted, no Delete is offered —
   * the caller passes it only when the list's delete access is not statically
   * false. The handler runs the deletion (row-by-row through the secured
   * context) and resolves once done; the bar owns only the confirm + pending
   * affordance.
   */
  onDelete?: () => Promise<void>
  /** Noun for the confirm copy (e.g. "post"). Defaults to "item". */
  itemName?: string
  /**
   * Seam for issue #736 (custom per-list Bulk actions): extra action controls
   * render in the `data-slot="selection-actions"` region, to the left of the
   * built-in Delete. This ships the named slot now so #736 can register
   * additional actions without changing this component's shape.
   */
  actions?: React.ReactNode
  className?: string
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: RowSelectionBarClassNames
}

/**
 * The selection bar shown above the list table while rows are selected
 * (issue #733). It reports the selection count, offers a Clear action and — when
 * `onDelete` is provided (delete access is not statically false) — the built-in
 * Bulk action Delete behind a confirmation.
 *
 * Styling uses Theme tokens only (no raw colours) and every part carries a named
 * Slot, so custom themes/branding can target the bar without forking it.
 */
export function RowSelectionBar({
  count,
  onClear,
  onDelete,
  itemName = 'item',
  actions,
  className,
  classNames,
}: RowSelectionBarProps) {
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [isPending, setIsPending] = React.useState(false)

  if (count === 0) return null

  const handleConfirm = async () => {
    if (!onDelete) return
    setShowConfirm(false)
    setIsPending(true)
    try {
      await onDelete()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div
      data-slot="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      className={cn(
        'flex items-center justify-between gap-4 rounded-lg border bg-muted/50 px-4 py-2',
        className,
        classNames?.root,
      )}
    >
      <span
        data-slot="selection-count"
        aria-live="polite"
        className={cn('text-sm font-medium tabular-nums text-foreground', classNames?.count)}
      >
        {count} selected
      </span>

      <div className="flex items-center gap-2">
        {/* Seam for #736: list-specific Bulk actions render here. */}
        <div
          data-slot="selection-actions"
          className={cn('flex items-center gap-2', classNames?.actions)}
        >
          {actions}
        </div>

        {onDelete && (
          <Button
            type="button"
            data-slot="selection-delete"
            variant="destructive"
            size="sm"
            onClick={() => setShowConfirm(true)}
            disabled={isPending}
            className={classNames?.delete}
          >
            {isPending && (
              <LoadingSpinner
                size="sm"
                className="border-primary-foreground border-t-transparent mr-2"
              />
            )}
            Delete
          </Button>
        )}

        <Button
          type="button"
          data-slot="selection-clear"
          variant="outline"
          size="sm"
          onClick={onClear}
          disabled={isPending}
          className={classNames?.clear}
        >
          Clear
        </Button>
      </div>

      {onDelete && (
        <ConfirmDialog
          isOpen={showConfirm}
          title={`Delete ${count} ${itemName}${count === 1 ? '' : 's'}`}
          message={`Are you sure you want to delete ${count} selected ${itemName}${
            count === 1 ? '' : 's'
          }? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}
