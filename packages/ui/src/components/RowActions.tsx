'use client'

import * as React from 'react'
import Link from 'next/link.js'
import {
  Archive,
  Check,
  Copy,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  Flag,
  Link2,
  Lock,
  LockOpen,
  Mail,
  Pencil,
  RefreshCw,
  Send,
  Star,
  Trash2,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import type { RowActionIcon } from '@opensaas/stack-core'
import { Button } from '../primitives/button.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { cn } from '../lib/utils.js'

const ROW_ACTION_ICONS: Record<RowActionIcon, LucideIcon> = {
  archive: Archive,
  check: Check,
  copy: Copy,
  download: Download,
  eye: Eye,
  'eye-off': EyeOff,
  flag: Flag,
  lock: Lock,
  mail: Mail,
  refresh: RefreshCw,
  send: Send,
  star: Star,
  trash: Trash2,
  undo: Undo2,
  unlock: LockOpen,
  upload: Upload,
}

/**
 * The serialisable metadata for one custom Row action — the only part of a
 * `ui.listView.rowActions` entry that crosses to the client.
 */
export interface SerializedRowAction {
  /** Stable id echoed back to dispatch the action server-side. */
  key: string
  /** Menu item label. */
  label: string
  /** Optional icon name. */
  icon?: RowActionIcon
  /** When true, the item is styled as destructive and confirms first. */
  destructive?: boolean
}

export interface RowActionsProps {
  /** The row's Item label, used to name the trigger and the confirm copy. */
  rowLabel: string
  /** The item page the built-in Edit opens and Copy link copies. */
  href: string
  /** The custom actions available on this row, in declaration order. */
  actions?: SerializedRowAction[]
  /** Run the custom action identified by `key`; resolves once it completes. */
  onRun?: (key: string) => Promise<void>
  /** Copy the item link; resolves once the outcome is reported. */
  onCopyLink: () => Promise<void>
  /** Delete the row; when omitted, Delete is not offered. */
  onDelete?: () => Promise<void>
  /** Noun for the delete confirm copy (e.g. "post"). Defaults to "item". */
  itemName?: string
  /** Optional class merged onto the trigger. */
  className?: string
}

type Pending = { kind: 'delete' } | { kind: 'action'; action: SerializedRowAction }

/**
 * A row's menu of Row actions: the built-in Edit and Copy link, the custom
 * actions available on this row, and Delete. A destructive custom action and
 * Delete confirm through {@link ConfirmDialog}.
 */
export function RowActions({
  rowLabel,
  href,
  actions = [],
  onRun,
  onCopyLink,
  onDelete,
  itemName = 'item',
  className,
}: RowActionsProps) {
  const [busy, setBusy] = React.useState(false)
  const [confirm, setConfirm] = React.useState<Pending | null>(null)
  const queued = React.useRef<Pending | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  const runAction = (action: SerializedRowAction) => {
    if (!onRun) return
    if (action.destructive) queued.current = { kind: 'action', action }
    else void run(() => onRun(action.key))
  }

  const confirmed = () => {
    const pending = confirm
    setConfirm(null)
    if (!pending) return
    if (pending.kind === 'delete') {
      if (onDelete) void run(onDelete)
    } else if (onRun) {
      void run(() => onRun(pending.action.key))
    }
  }

  const customActions = onRun ? actions : []

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="row-actions-trigger"
            aria-label={`Actions for ${rowLabel}`}
            disabled={busy}
            className={cn('h-8 w-8', className)}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={() => {
            const next = queued.current
            queued.current = null
            if (next) setConfirm(next)
          }}
        >
          <DropdownMenuItem asChild>
            <Link href={href} data-action-key="edit">
              <Pencil aria-hidden="true" />
              Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem data-action-key="copy-link" onSelect={() => void run(onCopyLink)}>
            <Link2 aria-hidden="true" />
            Copy link
          </DropdownMenuItem>
          {customActions.length > 0 && <DropdownMenuSeparator />}
          {customActions.map((action) => {
            const Icon = action.icon ? ROW_ACTION_ICONS[action.icon] : undefined
            return (
              <DropdownMenuItem
                key={action.key}
                data-action-key={action.key}
                destructive={action.destructive}
                onSelect={() => runAction(action)}
              >
                {Icon && <Icon aria-hidden="true" />}
                {action.label}
              </DropdownMenuItem>
            )
          })}
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-action-key="delete"
                destructive
                onSelect={() => {
                  queued.current = { kind: 'delete' }
                }}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {confirm && (
        <ConfirmDialog
          isOpen={true}
          title={
            confirm.kind === 'delete' ? `Delete this ${itemName}?` : `${confirm.action.label}?`
          }
          message={
            confirm.kind === 'delete'
              ? `“${rowLabel}” will be permanently deleted. This cannot be undone.`
              : `Are you sure you want to ${confirm.action.label.toLowerCase()} “${rowLabel}”?`
          }
          confirmLabel={confirm.kind === 'delete' ? 'Delete' : confirm.action.label}
          variant="danger"
          onConfirm={confirmed}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}
