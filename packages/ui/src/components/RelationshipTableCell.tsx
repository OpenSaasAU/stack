'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import { cn, formatFieldName } from '../lib/utils.js'
import { CellRenderer } from './cells/CellRenderer.js'
import { FieldRenderer } from './fields/FieldRenderer.js'
import { getFieldComponent } from './fields/registry.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import type { ServerActionInput } from '../server/types.js'

export interface RelationshipTableCellProps {
  rowId: string
  column: string
  /** The access-filtered, JSON-serialisable current value for this cell. */
  value: unknown
  /** Serialised field config — drives both the Cell and the edit control. */
  field: SerializableFieldConfig
  /** Admin base path, forwarded to relationship Cells for links. */
  basePath?: string
  /** Right-align (numeric columns) to match the header/read cell. */
  numeric?: boolean
  /**
   * Whether this column is inline-editable for the session: the related list's
   * update access is potentially allowed AND the field's update field-access is
   * not statically denied (decided server-side, #737). `false` renders a plain
   * read-only Cell with no edit affordance.
   */
  editable: boolean
  /** The related list key — the target list of the secured `updateRelated`. */
  relatedListKey: string
  /** Server action that runs the single-field update through the secured context. */
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

/**
 * Read the `{ updated, error?, fieldErrors? }` outcome an inline-edit server
 * action returns. An unrecognised shape is a failure (never a silent success),
 * so an in-place edit is never falsely reported as committed.
 */
function readUpdateOutcome(
  result: unknown,
  column: string,
): { ok: boolean; error?: string; fieldError?: string } {
  if (typeof result === 'object' && result !== null && 'updated' in result) {
    const record = result as { updated?: unknown; error?: unknown; fieldErrors?: unknown }
    const fieldErrors =
      typeof record.fieldErrors === 'object' && record.fieldErrors !== null
        ? (record.fieldErrors as Record<string, unknown>)
        : undefined
    const fieldError =
      fieldErrors && typeof fieldErrors[column] === 'string'
        ? (fieldErrors[column] as string)
        : undefined
    return {
      ok: record.updated === true,
      error: typeof record.error === 'string' ? record.error : undefined,
      fieldError,
    }
  }
  return { ok: false }
}

/** Whether focus has moved into an overlay this editor opened (e.g. a Radix
 * Select listbox or a date-picker popover, both portalled outside the cell).
 * Blur into such an overlay must NOT commit — the edit is still in progress. */
function isInOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.closest('[data-radix-popper-content-wrapper],[role="listbox"],[role="dialog"]') !== null
  )
}

/**
 * Inline cell edit for a Relationship table (issue #737, ADR-0018). The
 * `relationship-table-cell` seam's content: an editable cell that reuses the
 * shared registries — the Cell registry (`CellRenderer`) for its read display so
 * badges/formatting match the related list's own page, and the field-component
 * registry (`FieldRenderer`) for the edit control, so there is no bespoke
 * per-type input and no switch on field type.
 *
 * Interaction: clicking an editable cell enters edit mode (Enter/Space on the
 * focused display also works); Enter or blur commits, Escape cancels. A commit
 * is a single-field update on the RELATED row through the secured context
 * (`updateRelated`), so the related list's operation- and field-level update
 * access plus hooks/validation apply — never the parent's. The update is applied
 * optimistically and the table refreshed on success; a Silent failure (access
 * denied / row gone) or a validation error reverts the cell to its original
 * value and shows the reason (role="alert"), with any inline field error.
 *
 * Editable cells stop click propagation so they never also navigate the row;
 * non-editable cells render a plain read-only Cell and let the click bubble to
 * the row's navigation.
 */
export function RelationshipTableCell({
  rowId,
  column,
  value,
  field,
  basePath,
  numeric,
  editable,
  relatedListKey,
  serverAction,
}: RelationshipTableCellProps) {
  const router = useRouter()

  // The currently displayed (optimistic) value, the in-progress draft, and the
  // edit/pending/error state. `displayValue` is the source of truth for the read
  // Cell; it advances optimistically on a successful commit and re-syncs from the
  // refreshed `value` prop.
  const [displayValue, setDisplayValue] = React.useState<unknown>(value)
  const [isEditing, setIsEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<unknown>(value)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [fieldError, setFieldError] = React.useState<string | undefined>(undefined)

  const editorRef = React.useRef<HTMLDivElement>(null)
  // Guards a stray blur firing after Escape/commit already settled the edit.
  const settledRef = React.useRef(false)

  // When the server-refreshed `value` prop changes (e.g. after a committed edit's
  // `router.refresh()`), it becomes the new source of truth: reset the displayed
  // value during render (React's "adjust state on prop change" pattern — no
  // syncing effect). Optimistic commits set `displayValue` locally while `value`
  // is unchanged, so they still show immediately until the refresh settles.
  const [syncedValue, setSyncedValue] = React.useState<unknown>(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setDisplayValue(value)
  }

  // Focus the editor's control when entering edit mode (accessible affordance).
  React.useEffect(() => {
    if (!isEditing) return
    const focusable = editorRef.current?.querySelector<HTMLElement>(
      'input, textarea, select, button, [tabindex]',
    )
    focusable?.focus()
  }, [isEditing])

  // A cell is only truly editable when a field component is registered for it
  // (a third-party field without a registered form component falls back to a
  // read-only Cell rather than an "unsupported field type" placeholder).
  const hasFieldComponent = Boolean(
    field.ui?.component || getFieldComponent(field.ui?.fieldType ?? field.type),
  )
  const canEdit = editable && hasFieldComponent

  if (!canEdit) {
    return (
      <div data-slot="relationship-table-cell-display">
        <CellRenderer value={displayValue} field={field} fieldName={column} basePath={basePath} />
      </div>
    )
  }

  const label = field.label ?? formatFieldName(column)

  const startEdit = () => {
    settledRef.current = false
    setDraft(displayValue)
    setError(undefined)
    setFieldError(undefined)
    setIsEditing(true)
  }

  const cancel = () => {
    settledRef.current = true
    setDraft(displayValue)
    setIsEditing(false)
  }

  const commit = async () => {
    if (settledRef.current) return
    settledRef.current = true

    // No change → just leave edit mode without a round-trip.
    if (draft === displayValue) {
      setIsEditing(false)
      return
    }

    setPending(true)
    try {
      const outcome = readUpdateOutcome(
        await serverAction({
          listKey: relatedListKey,
          action: 'updateRelated',
          id: rowId,
          field: column,
          value: draft,
        }),
        column,
      )

      if (outcome.ok) {
        // Optimistically show the new value, then refresh so the re-fetched
        // (hook-transformed, access-filtered) value becomes the source of truth.
        setDisplayValue(draft)
        setError(undefined)
        setFieldError(undefined)
        setIsEditing(false)
        router.refresh()
      } else {
        // Revert with a visible reason (Silent failure or validation error);
        // never leak "denied vs absent" — the reason is the generic message.
        setError(outcome.error ?? 'Access denied or update failed')
        setFieldError(outcome.fieldError)
        setDraft(displayValue)
        setIsEditing(false)
      }
    } catch {
      setError('Update failed')
      setDraft(displayValue)
      setIsEditing(false)
    } finally {
      setPending(false)
    }
  }

  if (isEditing) {
    return (
      <div
        ref={editorRef}
        data-slot="relationship-table-cell-editor"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            void commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancel()
          }
        }}
        onBlur={(event) => {
          const next = event.relatedTarget
          // Neither counts as a commit: focus is still inside the editor, or
          // moved into an overlay it opened (see isInOverlay above).
          if (editorRef.current && next instanceof Node && editorRef.current.contains(next)) return
          if (isInOverlay(next)) return
          void commit()
        }}
      >
        <FieldRenderer
          fieldName={column}
          fieldConfig={field}
          value={draft}
          onChange={(next) => setDraft(next)}
          mode="edit"
          disabled={pending}
          error={fieldError}
          basePath={basePath}
        />
      </div>
    )
  }

  return (
    <div data-slot="relationship-table-cell-display">
      <button
        type="button"
        data-slot="relationship-table-cell-edit-trigger"
        // No aria-label: the button's accessible name stays the cell value (its
        // text content), so cell/row accessible names are unchanged from the
        // read-only table — only the role becomes interactive.
        title={`Edit ${label}`}
        className={cn(
          'w-full rounded px-1 py-0.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          numeric ? 'text-right' : 'text-left',
        )}
        onClick={(event) => {
          event.stopPropagation()
          startEdit()
        }}
      >
        <CellRenderer value={displayValue} field={field} fieldName={column} basePath={basePath} />
      </button>
      {(fieldError || error) && (
        <p
          role="alert"
          data-slot="relationship-table-cell-error"
          className="mt-1 text-xs text-destructive"
        >
          {fieldError ?? error}
        </p>
      )}
    </div>
  )
}
