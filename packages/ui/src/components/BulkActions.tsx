'use client'

import * as React from 'react'
import { Button } from '../primitives/button.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { LoadingSpinner } from './LoadingSpinner.js'
import type { BulkActionVariant } from '@opensaas/stack-core'

/**
 * The serialisable metadata for one custom Bulk action (issue #736). This is
 * the ONLY part of a `ui.listView.bulkActions` entry that crosses to the
 * client — the action's server-side `handler`/`hasAccess` functions never do.
 * The client renders a button from this data and sends `key` back through the
 * generic server action, which looks the handler up and runs it with the
 * rebuilt secured context.
 */
export interface SerializedBulkAction {
  /** Stable id echoed back to dispatch the action server-side. */
  key: string
  /** Button label. */
  label: string
  /** Button variant (defaults to `'outline'`). */
  variant?: BulkActionVariant
  /** When true, a confirmation is required before the action runs. */
  destructive?: boolean
}

export interface BulkActionsProps {
  /** The visible custom actions, in declaration order. */
  actions: SerializedBulkAction[]
  /**
   * Run the action identified by `key`. Resolves once the server round-trip
   * completes (the parent owns the actual server-action call, status reporting,
   * selection clearing, and table refresh).
   */
  onRun: (key: string) => Promise<void>
  /** Selected row count — used in the destructive-confirm copy. */
  count: number
  /** Noun for the confirm copy (e.g. "post"). Defaults to "item". */
  itemName?: string
  /** Optional class merged onto each action button. */
  className?: string
}

/**
 * Renders the list-specific custom Bulk actions (issue #736) inside the
 * selection bar's `data-slot="selection-actions"` region. Each action is a
 * button; a `destructive` action confirms first (reusing {@link ConfirmDialog},
 * the same affordance as the built-in Delete). While any action runs, every
 * button is disabled and the active one shows a spinner.
 *
 * Styling uses Theme tokens only and every action button carries a named Slot
 * (`data-slot="selection-action"`, plus `data-action-key`) so themes and tests
 * can target individual actions.
 */
export function BulkActions({
  actions,
  onRun,
  count,
  itemName = 'item',
  className,
}: BulkActionsProps) {
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [confirmKey, setConfirmKey] = React.useState<string | null>(null)

  if (actions.length === 0) return null

  const isPending = pendingKey !== null

  const run = async (key: string) => {
    setPendingKey(key)
    try {
      await onRun(key)
    } finally {
      setPendingKey(null)
    }
  }

  const handleClick = (action: SerializedBulkAction) => {
    if (action.destructive) setConfirmKey(action.key)
    else void run(action.key)
  }

  const confirmAction = confirmKey ? (actions.find((a) => a.key === confirmKey) ?? null) : null

  return (
    <>
      {actions.map((action) => (
        <Button
          key={action.key}
          type="button"
          data-slot="selection-action"
          data-action-key={action.key}
          variant={action.variant ?? 'outline'}
          size="sm"
          onClick={() => handleClick(action)}
          disabled={isPending}
          className={className}
        >
          {pendingKey === action.key && (
            <LoadingSpinner size="sm" className="mr-2 border-t-transparent" />
          )}
          {action.label}
        </Button>
      ))}

      {confirmAction && (
        <ConfirmDialog
          isOpen={true}
          title={`${confirmAction.label} ${count} ${itemName}${count === 1 ? '' : 's'}`}
          message={`Are you sure you want to ${confirmAction.label.toLowerCase()} ${count} selected ${itemName}${
            count === 1 ? '' : 's'
          }?`}
          confirmLabel={confirmAction.label}
          variant="danger"
          onConfirm={() => {
            const key = confirmAction.key
            setConfirmKey(null)
            void run(key)
          }}
          onCancel={() => setConfirmKey(null)}
        />
      )}
    </>
  )
}
