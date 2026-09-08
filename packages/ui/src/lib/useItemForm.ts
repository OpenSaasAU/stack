'use client'

import { useRef, useState, useTransition } from 'react'
import type { SerializableFieldConfig } from './serializeFieldConfig.js'

export type ItemFormAction = 'create' | 'update'

const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt']

/**
 * A to-many selection reached the submit transform from a control that never
 * told the user it was unwritable. The message names the field, and reaches
 * the form as its general error.
 */
export class UnwritableRelationshipError extends Error {
  readonly fieldName: string

  constructor(fieldName: string) {
    super(
      `"${fieldName}" was not saved: to-many relationships are not yet writable through this form. ` +
        `Edit those rows from their own list instead.`,
    )
    this.name = 'UnwritableRelationshipError'
    this.fieldName = fieldName
  }
}

/** Whether a relationship value carries a selection the user could lose. */
function hasSelection(value: unknown): boolean {
  return Array.isArray(value)
    ? value.length > 0
    : value !== null && value !== undefined && value !== ''
}

/**
 * Transform raw form state into the data shape expected by the server/Prisma.
 *
 * This is the shared submit transform used by every item form (the AdminUI
 * form and the standalone create/edit forms). Keeping it a pure function makes
 * it testable without rendering a component.
 *
 * Behaviour (the superset applied by all forms):
 * - Keys with no corresponding entry in `fields` are dropped (defense-in-depth:
 *   guards against a non-field key like `_count` reaching the submit payload).
 * - A to-one relationship is converted to `connect` shape; an empty one is
 *   omitted. A relationship the form rendered read-only sends nothing.
 * - Password fields whose value is an `{ isSet }` sentinel (an unchanged password
 *   read back from the server) are skipped, so they are not re-submitted.
 * - All other fields pass through unchanged (including `File` objects, which the
 *   Next.js server action serialises).
 *
 * @throws {UnwritableRelationshipError} when a to-many carries a value and was
 * not marked read-only, so no control could have shown the user it was
 * unwritable. Dropping it here would report success on input that never
 * reached the database.
 */
export function transformItemFormData(
  fields: Record<string, SerializableFieldConfig>,
  formData: Record<string, unknown>,
): Record<string, unknown> {
  const transformed: Record<string, unknown> = {}

  for (const [fieldName, value] of Object.entries(formData)) {
    const fieldConfig = fields[fieldName]
    if (!fieldConfig) {
      continue
    }

    // Virtual fields are computed and never writable. Core already strips
    // them before they reach Prisma, so this is defence-in-depth: a virtual
    // field's value can reach `formData` via `initialData` (the server's
    // resolved value for the item being edited) even though no editable
    // control ever calls `onChange` for it.
    if (fieldConfig.virtual) {
      continue
    }

    // A read-only field's value in `formData` is the one the server sent — its
    // control never calls `onChange` — so there is no user input to lose by
    // sending nothing for it. This is what a relationship whose foreign key
    // lives on the related row is marked as (ADR-0050).
    if (fieldConfig.readOnly) {
      continue
    }

    // Skip password fields carrying an { isSet } sentinel (unchanged password).
    if (typeof value === 'object' && value !== null && 'isSet' in value) {
      continue
    }

    if (fieldConfig.type === 'relationship') {
      // A to-many carrying an edge plan is written against the RELATED list,
      // one row at a time, before this payload is built (ADR-0050) — so it
      // belongs in neither.
      if (fieldConfig.edgeWrite) continue
      // Unreachable from a form whose fields came through `prepareItemForm`,
      // which marks a to-many read-only above. A caller that serialises field
      // configs itself (the standalone forms) can still get here — and its
      // control WAS editable, so the selection is the user's and must not
      // vanish into a payload that reports success.
      if (fieldConfig.many) {
        if (hasSelection(value)) throw new UnwritableRelationshipError(fieldName)
        continue
      }
      if (value) {
        transformed[fieldName] = { connect: { id: value } }
      }
    } else {
      transformed[fieldName] = value
    }
  }

  return transformed
}

/** The ids a to-many control holds, ignoring anything that is not one. */
function selectedIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/**
 * One to-many field's edges to write, as writes against the related list
 * (ADR-0050): `added` rows take the parent's id in their back-reference
 * column, `removed` rows have it cleared.
 */
export interface EdgeSelectionChange {
  fieldName: string
  /** The list each write runs against, and whose access decides it. */
  relatedListKey: string
  /** That list's column holding the link back to the record being edited. */
  backReferenceField: string
  /** The selection these changes are relative to — what a denied write leaves standing. */
  baseline: string[]
  added: string[]
  removed: string[]
}

/**
 * What the edge writes actually achieved. `persisted` is the selection the
 * database now holds for each field, which the form reverts its control to
 * when it differs from what the user picked; `errors` are the reasons the
 * denied writes gave, shown alongside.
 */
export interface EdgeWriteOutcome {
  persisted: Record<string, string[]>
  errors: string[]
}

/**
 * Diff each edge-writing to-many field's current selection against the
 * baseline, dropping the fields with nothing to write.
 */
export function diffEdgeSelections(
  fields: Record<string, SerializableFieldConfig>,
  baseline: Record<string, unknown>,
  formData: Record<string, unknown>,
): EdgeSelectionChange[] {
  const changes: EdgeSelectionChange[] = []

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    const plan = fieldConfig.edgeWrite
    if (!plan) continue

    const before = selectedIds(baseline[fieldName])
    const after = selectedIds(formData[fieldName])
    const added = after.filter((id) => !before.includes(id))
    const removed = before.filter((id) => !after.includes(id))
    if (added.length === 0 && removed.length === 0) continue

    changes.push({
      fieldName,
      relatedListKey: plan.relatedListKey,
      backReferenceField: plan.backReferenceField,
      baseline: before,
      added,
      removed,
    })
  }

  return changes
}

/**
 * Apply each field's `valueForClientSerialization` transform to initial data,
 * so values read from the server are shaped for the client form inputs.
 *
 * Operates on the original (non-serialized) field configs because the transform
 * function is stripped during serialization.
 */
export function transformInitialData<TData extends Record<string, unknown>>(
  fields: Record<string, unknown>,
  initialData: TData,
): TData {
  const transformed = { ...initialData }
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    const ui = (fieldConfig as { ui?: Record<string, unknown> }).ui
    const transformer = ui?.valueForClientSerialization
    if (typeof transformer === 'function') {
      transformed[fieldName as keyof TData] = (
        transformer as (args: { value: unknown }) => unknown
      )({ value: transformed[fieldName as keyof TData] }) as TData[keyof TData]
    }
  }
  return transformed
}

/**
 * Drop system fields (id, createdAt, updatedAt) from a field-config map,
 * returning the fields an item form should render, in declaration order.
 *
 * On `create` there is no item yet, so a virtual (computed) field has nothing
 * to show — it's dropped entirely. On `update` a virtual field is kept so the
 * form can display its resolved value read-only; `FieldRenderer` forces
 * read-only presentation for any field config flagged `virtual`, so it never
 * becomes an editable control (issue #821).
 */
export function getEditableFields(
  fields: Record<string, SerializableFieldConfig>,
  mode: ItemFormAction = 'update',
): Array<[string, SerializableFieldConfig]> {
  return Object.entries(fields).filter(([key, fieldConfig]) => {
    if (SYSTEM_FIELDS.includes(key)) return false
    if (mode === 'create' && fieldConfig.virtual) return false
    return true
  })
}

/**
 * Result of a form submission adapter. `false`/error means the submission
 * failed and the form should surface `error` (and optional per-field errors).
 */
export type ItemFormSubmitResult =
  { success: true } | { success: false; error: string; fieldErrors?: Record<string, string> }

export interface UseItemFormOptions {
  /** Serialized field configs (drives rendering + the submit transform). */
  fields: Record<string, SerializableFieldConfig>
  /** Initial form values (already client-serialized). */
  initialData?: Record<string, unknown>
  /** Whether this form creates or updates. Selects the submit action. */
  mode: ItemFormAction
  /**
   * Submit adapter. Receives the transformed data and the action; each caller
   * wires this to its own mechanism (AdminUI server action + navigation, or a
   * standalone `onSubmit` callback). May return void for the legacy/standalone
   * "throw on failure" style.
   */
  onSubmit: (
    data: Record<string, unknown>,
    action: ItemFormAction,
  ) => Promise<ItemFormSubmitResult | void>
  /**
   * Writes a submission's to-many edges against their related lists, before
   * `onSubmit` sends the record's own fields (ADR-0050). Required by any form
   * whose serialised fields carry an edge plan; without it those fields have
   * no writer and the submit refuses rather than reporting a selection saved.
   */
  onEdgeWrites?: (changes: EdgeSelectionChange[]) => Promise<EdgeWriteOutcome>
  /** Optional fallback message when a submit throws without a message. */
  errorFallback?: string
}

export interface UseItemFormResult {
  formData: Record<string, unknown>
  errors: Record<string, string>
  generalError: string | null
  isPending: boolean
  editableFields: Array<[string, SerializableFieldConfig]>
  handleFieldChange: (fieldName: string, value: unknown) => void
  handleSubmit: (e: { preventDefault: () => void }) => void
  setGeneralError: (message: string | null) => void
}

/**
 * The shared item-form engine.
 *
 * Holds the form state, the clear-error-on-change behaviour, the submit
 * transform, and the pending state (via `useTransition`) that every item form
 * needs. Callers supply only an `onSubmit` adapter and render the returned
 * fields/handlers — so the AdminUI form and the standalone create/edit forms
 * stay thin and share one tested code path.
 */
export function useItemForm({
  fields,
  initialData = {},
  mode,
  onSubmit,
  onEdgeWrites,
  errorFallback = 'Operation failed',
}: UseItemFormOptions): UseItemFormResult {
  const [isPending, startTransition] = useTransition()
  const [formData, setFormData] = useState<Record<string, unknown>>(initialData)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  // What the edges are diffed against. It advances to whatever the writes
  // actually persisted, so a second submit after a partial denial retries only
  // the edges that are still outstanding rather than the ones already stored.
  const edgeBaseline = useRef<Record<string, unknown>>(initialData)

  const handleFieldChange = (fieldName: string, value: unknown) => {
    // A field the form rendered read-only has no input to accept: its control
    // was handed `mode="read"`. A third-party component that ignores that and
    // calls this anyway would otherwise put a value into `formData` that the
    // submit transform then has to drop — a selection shown as accepted and
    // discarded at save, which is the failure ADR-0050's marking exists to
    // stop. Refusing it here keeps the control showing the stored value.
    const fieldConfig = fields[fieldName]
    if (fieldConfig?.readOnly || fieldConfig?.virtual) return

    setFormData((prev) => ({ ...prev, [fieldName]: value }))
    if (errors[fieldName]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[fieldName]
        return next
      })
    }
  }

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setErrors({})
    setGeneralError(null)

    startTransition(async () => {
      try {
        // Edges go first, and a denial stops here: `onSubmit` navigates away
        // on success, so a revert the user is meant to see has to happen while
        // the form is still on screen.
        const changes = diffEdgeSelections(fields, edgeBaseline.current, formData)
        if (changes.length > 0) {
          if (!onEdgeWrites) throw new UnwritableRelationshipError(changes[0].fieldName)
          const outcome = await onEdgeWrites(changes)
          edgeBaseline.current = { ...edgeBaseline.current, ...outcome.persisted }
          if (outcome.errors.length > 0) {
            setFormData((prev) => ({ ...prev, ...outcome.persisted }))
            setGeneralError(outcome.errors.join(' '))
            return
          }
        }

        // Inside the try: the transform refuses a payload it would otherwise
        // have to discard, and that refusal has to reach the user as the
        // form's error rather than as an unhandled rejection.
        const data = transformItemFormData(fields, formData)
        const result = await onSubmit(data, mode)
        // void result → adapter handles its own success/navigation.
        if (result && result.success === false) {
          if (result.fieldErrors) setErrors(result.fieldErrors)
          setGeneralError(result.error || errorFallback)
        }
      } catch (error: unknown) {
        setGeneralError((error as Error)?.message || errorFallback)
      }
    })
  }

  return {
    formData,
    errors,
    generalError,
    isPending,
    editableFields: getEditableFields(fields, mode),
    handleFieldChange,
    handleSubmit,
    setGeneralError,
  }
}
