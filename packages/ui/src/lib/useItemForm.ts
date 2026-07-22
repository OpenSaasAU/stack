'use client'

import { useState, useTransition } from 'react'
import type { SerializableFieldConfig } from './serializeFieldConfig.js'

/**
 * The action an item form submission represents.
 */
export type ItemFormAction = 'create' | 'update'

const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt']

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
 * - Relationship fields are converted to Prisma `connect` shape (single or many).
 *   Empty single relationships and empty many-arrays are omitted.
 * - Password fields whose value is an `{ isSet }` sentinel (an unchanged password
 *   read back from the server) are skipped, so they are not re-submitted.
 * - All other fields pass through unchanged (including `File` objects, which the
 *   Next.js server action serialises).
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

    // Skip password fields carrying an { isSet } sentinel (unchanged password).
    if (typeof value === 'object' && value !== null && 'isSet' in value) {
      continue
    }

    if (fieldConfig.type === 'relationship') {
      if (fieldConfig.many) {
        if (Array.isArray(value) && value.length > 0) {
          transformed[fieldName] = { connect: value.map((id: string) => ({ id })) }
        }
      } else if (value) {
        transformed[fieldName] = { connect: { id: value } }
      }
    } else {
      transformed[fieldName] = value
    }
  }

  return transformed
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
 * returning the editable entries in declaration order.
 */
export function getEditableFields(
  fields: Record<string, SerializableFieldConfig>,
): Array<[string, SerializableFieldConfig]> {
  return Object.entries(fields).filter(([key]) => !SYSTEM_FIELDS.includes(key))
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
  errorFallback = 'Operation failed',
}: UseItemFormOptions): UseItemFormResult {
  const [isPending, startTransition] = useTransition()
  const [formData, setFormData] = useState<Record<string, unknown>>(initialData)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)

  const handleFieldChange = (fieldName: string, value: unknown) => {
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
      const data = transformItemFormData(fields, formData)
      try {
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
    editableFields: getEditableFields(fields),
    handleFieldChange,
    handleSubmit,
    setGeneralError,
  }
}
