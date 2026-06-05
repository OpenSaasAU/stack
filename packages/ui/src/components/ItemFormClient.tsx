'use client'

import * as React from 'react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation.js'
import { FieldRenderer } from './fields/FieldRenderer.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { LoadingSpinner } from './LoadingSpinner.js'
import { Button } from '../primitives/button.js'
import type { ServerActionInput } from '../server/types.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import { useItemForm, type ItemFormSubmitResult } from '../lib/useItemForm.js'

export interface ItemFormClientProps {
  listKey: string
  urlKey: string
  mode: 'create' | 'edit'
  fields: Record<string, SerializableFieldConfig>
  initialData?: Record<string, unknown>
  itemId?: string
  basePath: string
  serverAction: (input: ServerActionInput) => Promise<unknown>
  relationshipData?: Record<string, Array<{ id: string; label: string }>>
  /**
   * Whether to render the delete affordance in edit mode. Defaults to `true`.
   * Singletons set this to `false` — a singleton has exactly one record that
   * can't be deleted (core blocks `delete` even in sudo), so the control is
   * suppressed for UX hygiene.
   */
  canDelete?: boolean
}

/**
 * Normalise a server action's response into the form engine's result shape.
 * Supports both the `{ success, error, fieldErrors }` envelope and the legacy
 * "truthy data = success, null = access denied" convention.
 */
function toSubmitResult(result: unknown, deniedMessage: string): ItemFormSubmitResult {
  if (result && typeof result === 'object' && 'success' in result) {
    const r = result as
      | { success: true; data: unknown }
      | { success: false; error: string; fieldErrors?: Record<string, string> }
    return r.success
      ? { success: true }
      : { success: false, error: r.error, fieldErrors: r.fieldErrors }
  }
  if (result) return { success: true }
  return { success: false, error: deniedMessage }
}

/**
 * Client component for the AdminUI item form.
 *
 * Shares the form state/transform/error/pending logic with the standalone
 * forms via `useItemForm`; this component only adapts submission to the
 * AdminUI server action + router navigation, and adds the delete flow.
 */
export function ItemFormClient({
  listKey,
  urlKey,
  mode,
  fields,
  initialData = {},
  itemId,
  basePath,
  serverAction,
  relationshipData = {},
  canDelete = true,
}: ItemFormClientProps) {
  const router = useRouter()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // Separate transition for delete (not a form submit, so outside the engine).
  const [isDeleting, startDeleteTransition] = useTransition()

  const {
    formData,
    errors,
    generalError,
    isPending,
    editableFields,
    handleFieldChange,
    handleSubmit,
    setGeneralError,
  } = useItemForm({
    fields,
    initialData,
    mode: mode === 'create' ? 'create' : 'update',
    errorFallback: 'Access denied or operation failed',
    onSubmit: async (data, action) => {
      const result =
        action === 'create'
          ? await serverAction({ listKey, action: 'create', data })
          : await serverAction({ listKey, action: 'update', id: itemId!, data })

      const normalized = toSubmitResult(result, 'Access denied or operation failed')
      if (normalized.success) {
        router.push(`${basePath}/${urlKey}`)
        router.refresh()
      }
      return normalized
    },
  })

  const handleDelete = () => {
    if (!itemId) return
    setGeneralError(null)
    setShowDeleteConfirm(false)

    startDeleteTransition(async () => {
      const result = await serverAction({ listKey, action: 'delete', id: itemId })
      const normalized = toSubmitResult(result, 'Access denied or failed to delete item')
      if (normalized.success) {
        router.push(`${basePath}/${urlKey}`)
        router.refresh()
      } else {
        setGeneralError(normalized.error)
      }
    })
  }

  const busy = isPending || isDeleting

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* General Error */}
      {generalError && (
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-4">
          <p className="text-sm font-medium">{generalError}</p>
        </div>
      )}

      {/* Form Fields */}
      <div className="space-y-6">
        {editableFields.map(([fieldName, fieldConfig]) => (
          <FieldRenderer
            key={fieldName}
            fieldName={fieldName}
            fieldConfig={fieldConfig}
            value={formData[fieldName]}
            onChange={(value) => handleFieldChange(fieldName, value)}
            error={errors[fieldName]}
            disabled={busy}
            mode="edit"
            relationshipItems={relationshipData[fieldName] || []}
            relationshipLoading={false}
            basePath={basePath}
          />
        ))}
      </div>

      {/* Form Actions */}
      <div className="flex items-center justify-between pt-6 border-t border-border">
        <div className="flex gap-3">
          <Button type="submit" disabled={busy} className="gap-2">
            {isPending && (
              <LoadingSpinner
                size="sm"
                className="border-primary-foreground border-t-transparent"
              />
            )}
            {isPending ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push(`${basePath}/${urlKey}`)}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>

        {/* Delete Button (Edit Mode Only; suppressed for singletons) */}
        {mode === 'edit' && itemId && canDelete && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={busy}
          >
            Delete
          </Button>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </form>
  )
}
