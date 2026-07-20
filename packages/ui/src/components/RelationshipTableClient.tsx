'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import { cn, formatFieldName, isNumericField } from '../lib/utils.js'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '../primitives/table.js'
import { Card } from '../primitives/card.js'
import { Button } from '../primitives/button.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { CellRenderer } from './cells/CellRenderer.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import type { ServerActionInput } from '../server/types.js'

/**
 * Which removal control a Relationship-table row shows (ADR-0018, issue #739):
 * - `'disconnect'` — a ✕ that unlinks the related row (non-destructive).
 * - `'delete'` — a ✕ that deletes the related row after a confirmation.
 * - `null` — no control (removeAction `'none'`, a required-FK relationship, or
 *   the session lacks the related list's update/delete access).
 */
export type RemoveMode = 'disconnect' | 'delete' | null

export interface RelationshipTableClientProps {
  /** Section heading (the relationship field name, title-cased). */
  title: string
  /** URL key of the related list, for row-click navigation. */
  relatedUrlKey: string
  /** Admin base path (e.g. `/admin`). */
  basePath: string
  /** Column field names, in order. */
  columns: string[]
  /** Serialised field config per column, driving Cell resolution. */
  fields: Record<string, SerializableFieldConfig>
  /** Serialised, access-filtered related rows (relationship values pre-resolved). */
  rows: Array<Record<string, unknown>>
  /** Total access-visible row count, always shown in the footer. */
  count: number
  /** Columns summed in the footer (explicit opt-in only). */
  sumColumns: string[]
  /** Per-column footer sum, rendered through that column's Cell. */
  sums: Record<string, number>
  /** The removal control to render per row (issue #739); `null` renders none. */
  removeMode: RemoveMode
  /** The related list key — the target of the disconnect/delete server action. */
  relatedListKey: string
  /** The back-reference field on the related list (present when disconnectable). */
  backReferenceField?: string
  /** The parent record id — the disconnect target for many-to-many rows. */
  parentId: string
  /** The list being edited (used for accessible labelling). */
  parentListKey: string
  /** Server action that runs removals through the secured context. */
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

/** Read the `{ removed, error? }` outcome a row-removal server action returns. */
function readRemoveOutcome(result: unknown): { ok: boolean; error?: string } {
  if (typeof result === 'object' && result !== null && 'removed' in result) {
    const record = result as { removed?: unknown; error?: unknown }
    return {
      ok: record.removed === true,
      error: typeof record.error === 'string' ? record.error : undefined,
    }
  }
  // An unrecognised shape is treated as a failure so the row is never silently lost.
  return { ok: false }
}

/**
 * Read-only Relationship table (issue #734) plus row removal (issue #739),
 * client half. Renders related rows as a table whose cells come from the cell
 * registry (`CellRenderer`), so badges/formatting match the related list's own
 * page. Rows navigate to the related record on click.
 *
 * Row removal (ADR-0018): when `removeMode` is set, each row gains a trailing ✕.
 * `'disconnect'` unlinks the row (an update on the related list, nulling the
 * back-reference); `'delete'` confirms then deletes it. Both run through the
 * secured context, so a denial is a Silent failure — the row stays with a
 * visible reason. A success refreshes the table (`router.refresh`).
 *
 * Named Slots (the reviewed extension seams for the follow-up tickets):
 * - `relationship-table` — the section container.
 * - `relationship-table-toolbar` — header actions region; the pre-linked create
 *   drawer's "+ Add" (#738) mounts here.
 * - `relationship-table-row` — a related row; the removal ✕ (#739) is its
 *   trailing affordance.
 * - `relationship-table-remove` — the row-removal control (#739).
 * - `relationship-table-cell` — a rendered cell; inline cell edit (#737) wraps
 *   the Cell here.
 * - `relationship-table-footer` — the totals footer (count + configured sums).
 */
export function RelationshipTableClient({
  title,
  relatedUrlKey,
  basePath,
  columns,
  fields,
  rows,
  count,
  sumColumns,
  sums,
  removeMode,
  relatedListKey,
  backReferenceField,
  parentId,
  serverAction,
}: RelationshipTableClientProps) {
  const router = useRouter()
  const sumColumnSet = React.useMemo(() => new Set(sumColumns), [sumColumns])

  // Rows optimistically hidden after a successful removal (until the refresh
  // re-fetch settles), per-row failure reasons, the in-flight row, and the row
  // awaiting a delete confirmation.
  const [removedIds, setRemovedIds] = React.useState<Set<string>>(() => new Set())
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [confirmId, setConfirmId] = React.useState<string | null>(null)

  const columnFieldType = (column: string): string | undefined => fields[column]?.type
  const showRemove = removeMode !== null
  const removeVerb = removeMode === 'delete' ? 'Delete' : 'Disconnect'
  const totalColumns = columns.length + (showRemove ? 1 : 0)

  const performRemove = async (rowId: string) => {
    setPendingId(rowId)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })

    try {
      let input: ServerActionInput
      if (removeMode === 'delete') {
        input = { listKey: relatedListKey, action: 'removeRelated', mode: 'delete', id: rowId }
      } else if (removeMode === 'disconnect' && backReferenceField) {
        input = {
          listKey: relatedListKey,
          action: 'removeRelated',
          mode: 'disconnect',
          id: rowId,
          field: backReferenceField,
          parentId,
        }
      } else {
        return
      }

      const outcome = readRemoveOutcome(await serverAction(input))
      if (outcome.ok) {
        // Optimistically hide, then refresh so the re-fetched table no longer
        // includes the row (or, on a race, restores it as the source of truth).
        setRemovedIds((prev) => new Set(prev).add(rowId))
        router.refresh()
      } else {
        // Silent failure: leave the row and show why (never leak "denied vs
        // does not exist" — the reason is the generic access message).
        setErrors((prev) => ({
          ...prev,
          [rowId]: outcome.error ?? 'Access denied or removal failed',
        }))
      }
    } catch {
      setErrors((prev) => ({ ...prev, [rowId]: 'Removal failed' }))
    } finally {
      setPendingId(null)
      setConfirmId(null)
    }
  }

  const onRemoveClick = (rowId: string) => {
    if (removeMode === 'delete') {
      setConfirmId(rowId)
    } else {
      void performRemove(rowId)
    }
  }

  const visibleRows = rows.filter((row) => !removedIds.has(String(row.id)))

  return (
    <Card data-slot="relationship-table" className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border p-4">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {/* Seam: the pre-linked create drawer's "+ Add" control (#738) mounts here. */}
        <div data-slot="relationship-table-toolbar" className="flex items-center gap-2" />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => {
              const numeric = isNumericField(columnFieldType(column))
              return (
                <TableHead key={column} className={cn(numeric && 'text-right')}>
                  {formatFieldName(column)}
                </TableHead>
              )
            })}
            {showRemove && (
              <TableHead className="w-0 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>

        <TableBody>
          {visibleRows.length === 0 ? (
            <TableRow>
              <TableCell
                data-slot="relationship-table-empty"
                colSpan={Math.max(totalColumns, 1)}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No related {title.toLowerCase()} yet.
              </TableCell>
            </TableRow>
          ) : (
            visibleRows.map((row) => {
              const rowId = String(row.id)
              const error = errors[rowId]
              return (
                <TableRow
                  key={rowId}
                  data-slot="relationship-table-row"
                  className="cursor-pointer"
                  onClick={() => router.push(`${basePath}/${relatedUrlKey}/${rowId}`)}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column}
                      data-slot="relationship-table-cell"
                      className={cn(isNumericField(columnFieldType(column)) && 'text-right')}
                    >
                      {/* Read-only Cell; inline cell edit (#737) wraps this. */}
                      <CellRenderer
                        value={row[column]}
                        field={fields[column] ?? { type: 'text' }}
                        fieldName={column}
                        basePath={basePath}
                      />
                    </TableCell>
                  ))}
                  {showRemove && (
                    <TableCell className="text-right align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-slot="relationship-table-remove"
                        aria-label={`${removeVerb} ${title} row`}
                        disabled={pendingId === rowId}
                        onClick={(event) => {
                          // Don't let the removal click also navigate the row.
                          event.stopPropagation()
                          onRemoveClick(rowId)
                        }}
                      >
                        <span aria-hidden="true">✕</span>
                      </Button>
                      {error && (
                        <p
                          role="alert"
                          data-slot="relationship-table-remove-error"
                          className="mt-1 text-xs text-destructive"
                        >
                          {error}
                        </p>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })
          )}
        </TableBody>

        <TableFooter>
          <TableRow data-slot="relationship-table-footer">
            {columns.length === 0 ? (
              // No columns (related list curates to nothing but the back-reference):
              // still always show the row count, mirroring the empty-body colSpan.
              <TableCell
                colSpan={Math.max(totalColumns, 1)}
                className="text-sm text-muted-foreground"
              >
                {count} {count === 1 ? 'row' : 'rows'}
              </TableCell>
            ) : (
              <>
                {columns.map((column, index) => {
                  const numeric = isNumericField(columnFieldType(column))
                  const isSummed = sumColumnSet.has(column)
                  return (
                    <TableCell key={column} className={cn(numeric && 'text-right')}>
                      {index === 0 && (
                        <span className="text-sm text-muted-foreground">
                          {count} {count === 1 ? 'row' : 'rows'}
                        </span>
                      )}
                      {isSummed && (
                        <span className={cn('font-medium', index === 0 && 'ml-2')}>
                          <CellRenderer
                            value={sums[column]}
                            field={fields[column] ?? { type: 'text' }}
                            fieldName={column}
                            basePath={basePath}
                          />
                        </span>
                      )}
                    </TableCell>
                  )
                })}
                {showRemove && <TableCell className="w-0" />}
              </>
            )}
          </TableRow>
        </TableFooter>
      </Table>

      {/* Delete opt-in requires a confirmation before the destructive action. */}
      <ConfirmDialog
        isOpen={confirmId !== null}
        title={`Delete ${title} row`}
        message={`This permanently deletes the related ${title.toLowerCase()} record. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (confirmId) void performRemove(confirmId)
        }}
        onCancel={() => setConfirmId(null)}
      />
    </Card>
  )
}
