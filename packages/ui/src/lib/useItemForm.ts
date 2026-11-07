'use client'

import { unstable_rethrow } from 'next/navigation.js'
import { useEffect, useMemo, useRef, useState, useTransition, type RefObject } from 'react'
import type { FieldFocusTarget, FieldValidityChannel } from './fieldValidity.js'
import type { SerializableFieldConfig } from './serializeFieldConfig.js'
import { resolveFieldLabel } from './utils.js'

export type ItemFormAction = 'create' | 'update'

interface InvalidMark {
  fieldName: string
  focusTarget: FieldFocusTarget
  onRefused: () => void
}

const SYSTEM_FIELDS = ['id']

// Value controls only. A field's first button can be its Remove, which Enter would then press.
const VALUE_CONTROLS =
  'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]'

function focusAndReveal(element: HTMLElement): boolean {
  element.focus({ preventScroll: true })
  if (document.activeElement !== element) return false
  // Centred, so neither the sticky top bar nor the scroller's edge hides it or its label.
  element.scrollIntoView({ block: 'center' })
  return true
}

/**
 * What a failed submit may land on inside a field, best first: the control the
 * browser refused, invalid controls, then value controls.
 */
function fieldFocusCandidates(field: Element, refusedControl?: Element): HTMLElement[] {
  return [
    ...(refusedControl instanceof HTMLElement ? [refusedControl] : []),
    ...field.querySelectorAll<HTMLElement>('[aria-invalid="true"]'),
    ...field.querySelectorAll<HTMLElement>(VALUE_CONTROLS),
  ].filter((element) => element.tabIndex >= 0 && !element.closest('[hidden], [aria-hidden="true"]'))
}

type ConstrainedControl = Element &
  Pick<HTMLInputElement, 'willValidate' | 'validity' | 'validationMessage'>

function isConstrainedControl(element: Element): element is ConstrainedControl {
  return 'validity' in element
}

interface ConstraintError {
  message: string
  control: Element
}

/**
 * The first control the browser's constraint validation refuses in each field.
 * This reads the constraints a control declares (`required`, `min`, a number
 * input's unparseable text), so a field needs no check of its own, and the
 * hidden select Radix renders counts for its trigger.
 */
function readConstraintErrors(
  form: HTMLFormElement,
  fields: Record<string, SerializableFieldConfig>,
  skip: Set<string>,
): Map<string, ConstraintError> {
  const refused = new Map<string, ConstraintError>()
  for (const control of Array.from(form.elements)) {
    if (!isConstrainedControl(control) || !control.willValidate || control.validity.valid) continue
    const fieldName = control.closest<HTMLElement>('[data-field-name]')?.dataset.fieldName
    if (!fieldName || skip.has(fieldName) || refused.has(fieldName)) continue
    const label = resolveFieldLabel(fieldName, fields[fieldName])
    // Chrome sets `valueMissing` too when a number input holds text it can't parse.
    const isEmpty = control.validity.valueMissing && !control.validity.badInput
    const message = isEmpty
      ? `${label} is required`
      : control.validationMessage || `${label} is invalid`
    refused.set(fieldName, { message, control })
  }
  return refused
}

function fieldElements(form: HTMLFormElement | null): HTMLElement[] {
  return Array.from(form?.querySelectorAll<HTMLElement>('[data-field-name]') ?? [])
}

function withoutKey<TValue>(map: Map<string, TValue>, key: string): Map<string, TValue> {
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)
  return next
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Deep equality over the JSON-shaped values a form field holds. Anything else (a `File`) is equal only to itself. */
function isEqualValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => isEqualValue(item, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && isEqualValue(a[key], b[key]))
    )
  }
  return false
}

/** Keep only the entries of a submit payload whose value differs from the baseline payload. */
export function pickDirtyFields(
  payload: Record<string, unknown>,
  baseline: Record<string, unknown>,
): Record<string, unknown> {
  const dirty: Record<string, unknown> = {}
  for (const [fieldName, value] of Object.entries(payload)) {
    if (!(fieldName in baseline) || !isEqualValue(value, baseline[fieldName])) {
      dirty[fieldName] = value
    }
  }
  return dirty
}

/** Drop each emptied value a create should leave to the field's own default. */
function omitEmptiedDefaults(
  fields: Record<string, SerializableFieldConfig>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([fieldName, value]) => value !== null || !fields[fieldName]?.emptyTakesDefaultOnCreate,
    ),
  )
}

/**
 * The ids a to-many control holds, as the strings the server action's id
 * boundary parses back to the list's own key type. A custom control registered
 * for the field can hand back an `int autoincrement` row's id as the number it
 * is; dropping it would diff as a deselect and silently clear a foreign key
 * the user never touched.
 */
function selectedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const id of value) {
    if (typeof id === 'string') ids.push(id)
    else if (typeof id === 'number') ids.push(String(id))
  }
  return ids
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
 * Prefixes the record update's own failure when the edge writes ahead of it
 * already landed. The edges are separate writes against another list and are
 * not rolled back, so a bare "update failed" would describe a save that was in
 * fact half applied.
 */
export const PARTIAL_SAVE_PREFIX =
  'The related records were relinked, but this record was not saved:'

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
 * Drop system fields (id) from a field-config map,
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
  /**
   * Runs instead of `onSubmit` when an update changed nothing: no field differs
   * from the loaded values and no edge changed. Wire it to the same success
   * path `onSubmit` takes.
   */
  onUnchanged?: () => void
  /** Optional fallback message when a submit throws without a message. */
  errorFallback?: string
}

/** The parts of a submit event the engine acts on. */
export interface ItemFormSubmitEvent {
  preventDefault: () => void
  stopPropagation: () => void
}

export interface UseItemFormResult {
  formData: Record<string, unknown>
  errors: Record<string, string>
  generalError: string | null
  isPending: boolean
  editableFields: Array<[string, SerializableFieldConfig]>
  handleFieldChange: (fieldName: string, value: unknown) => void
  handleSubmit: (e: ItemFormSubmitEvent) => void
  setGeneralError: (message: string | null) => void
  /** Provide through `FieldValidityContext` around the rendered fields. */
  validity: FieldValidityChannel
  /**
   * Attach to the `<form>`, which must also set `noValidate`: the browser's own
   * check would stop the submit before this engine sees it, and focus a control
   * that can show no error.
   */
  formRef: RefObject<HTMLFormElement | null>
  /** Attach to the element showing `generalError`, with `tabIndex={-1}`. */
  errorBannerRef: RefObject<HTMLDivElement | null>
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
  onUnchanged,
  errorFallback = 'Operation failed',
}: UseItemFormOptions): UseItemFormResult {
  const [isPending, startTransition] = useTransition()
  const [formData, setFormData] = useState<Record<string, unknown>>(initialData)
  const [serverErrors, setServerErrors] = useState<Map<string, string>>(new Map())
  const [constraintErrors, setConstraintErrors] = useState<Map<string, string>>(new Map())
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [unshownErrors, setUnshownErrors] = useState<string | null>(null)
  // What the edges are diffed against. It advances to whatever the writes
  // actually persisted, so a second submit after a partial denial retries only
  // the edges that are still outstanding rather than the ones already stored.
  const edgeBaseline = useRef<Record<string, unknown>>(initialData)
  const scalarBaseline = useRef<Record<string, unknown> | null>(null)
  const invalidMarks = useRef(new Set<InvalidMark>())
  const formRef = useRef<HTMLFormElement>(null)
  const errorBannerRef = useRef<HTMLDivElement>(null)
  const focusPending = useRef(false)
  const refusedControls = useRef(new Map<string, Element>())

  const errors = useMemo(() => {
    // No prototype, so looking up a field named `constructor` finds only its error.
    const merged: Record<string, string> = Object.create(null)
    for (const [fieldName, message] of [...serverErrors, ...constraintErrors]) {
      merged[fieldName] = message
    }
    return merged
  }, [serverErrors, constraintErrors])

  const setGeneralError = (message: string | null) => {
    focusPending.current = message !== null
    setBannerError(message)
  }

  // Waits on `isPending` because the controls stay disabled, and so unfocusable,
  // until the transition settles.
  useEffect(() => {
    if (isPending || !focusPending.current) return
    focusPending.current = false

    const firstWithError = fieldElements(formRef.current).find(
      (field) => field.dataset.fieldName && errors[field.dataset.fieldName],
    )
    const refusedControl = refusedControls.current.get(firstWithError?.dataset.fieldName ?? '')
    if (firstWithError && fieldFocusCandidates(firstWithError, refusedControl).some(focusAndReveal))
      return
    if (errorBannerRef.current) focusAndReveal(errorBannerRef.current)
  }, [isPending, errors, bannerError])

  // A field that ignores its `error` prop must not refuse in silence.
  useEffect(() => {
    const fieldsOnScreen = fieldElements(formRef.current)
    const unshown = [...constraintErrors].flatMap(([fieldName, message]) => {
      const field = fieldsOnScreen.find((element) => element.dataset.fieldName === fieldName)
      if (field?.textContent?.includes(message)) return []
      const label = resolveFieldLabel(fieldName, fields[fieldName])
      return [message.includes(label) ? message : `${label}: ${message}`]
    })
    setUnshownErrors(unshown.join(' ') || null)
  }, [constraintErrors, fields])

  const validity = useMemo<FieldValidityChannel>(
    () => ({
      markInvalid: (fieldName, focusTarget, onRefused) => {
        const mark = { fieldName, focusTarget, onRefused }
        invalidMarks.current.add(mark)
        // The mark's own message takes over, and a parsing field may never call `onChange`.
        setServerErrors((prev) => withoutKey(prev, fieldName))
        setConstraintErrors((prev) => withoutKey(prev, fieldName))
        return () => {
          invalidMarks.current.delete(mark)
        }
      },
    }),
    [],
  )

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
    setServerErrors((prev) => withoutKey(prev, fieldName))
    setConstraintErrors((prev) => withoutKey(prev, fieldName))
  }

  const handleSubmit = (e: ItemFormSubmitEvent) => {
    e.preventDefault()
    // React bubbles `submit` through portals, so a form portalled out of a field reaches the form around it.
    e.stopPropagation()

    const marks = [...invalidMarks.current]
    const marked = new Set(marks.map((mark) => mark.fieldName))
    const refused = formRef.current
      ? readConstraintErrors(formRef.current, fields, marked)
      : new Map<string, ConstraintError>()
    setConstraintErrors(new Map([...refused].map(([name, { message }]) => [name, message])))
    refusedControls.current = new Map([...refused].map(([name, { control }]) => [name, control]))

    if (marks.length > 0 || refused.size > 0) {
      for (const mark of marks) mark.onRefused()

      const firstField = Object.keys(fields).find((name) => marked.has(name) || refused.has(name))
      const firstMark =
        firstField === undefined ? marks[0] : marks.find((mark) => mark.fieldName === firstField)
      if (firstMark) firstMark.focusTarget.current?.focus()
      else focusPending.current = true
      return
    }

    setServerErrors(new Map())
    setBannerError(null)

    startTransition(async () => {
      // Set once the edges have landed. They are writes against another list
      // and nothing rolls them back, so every failure reported after this
      // point has to say the save was partial.
      let edgesCommitted = false
      const report = (message: string) =>
        setGeneralError(edgesCommitted ? `${PARTIAL_SAVE_PREFIX} ${message}` : message)

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
          edgesCommitted = true
        }

        // Inside the try: the transform refuses a payload it would otherwise
        // have to discard, and that refusal has to reach the user as the
        // form's error rather than as an unhandled rejection.
        const full = transformItemFormData(fields, formData)
        let data = full
        if (mode === 'update') {
          scalarBaseline.current ??= transformItemFormData(fields, initialData)
          data = pickDirtyFields(full, scalarBaseline.current)
          for (const [fieldName, fieldConfig] of Object.entries(fields)) {
            const clearable =
              fieldConfig.type === 'relationship' &&
              !fieldConfig.many &&
              !fieldConfig.readOnly &&
              !fieldConfig.edgeWrite
            if (clearable && fieldName in scalarBaseline.current && !(fieldName in full)) {
              data[fieldName] = null
            }
          }
          if (Object.keys(data).length === 0) {
            onUnchanged?.()
            return
          }
        } else {
          data = omitEmptiedDefaults(fields, full)
        }
        const result = await onSubmit(data, mode)
        // void result → adapter handles its own success/navigation.
        if (result && result.success === false) {
          if (result.fieldErrors) setServerErrors(new Map(Object.entries(result.fieldErrors)))
          report(result.error || errorFallback)
        } else if (mode === 'update') {
          scalarBaseline.current = { ...scalarBaseline.current, ...data }
        }
      } catch (error: unknown) {
        unstable_rethrow(error)
        report(error instanceof Error && error.message ? error.message : errorFallback)
      }
    })
  }

  return {
    formData,
    errors,
    generalError: [bannerError, unshownErrors].filter(Boolean).join(' ') || null,
    isPending,
    editableFields: getEditableFields(fields, mode),
    handleFieldChange,
    handleSubmit,
    setGeneralError,
    validity,
    formRef,
    errorBannerRef,
  }
}
