'use client'

import * as React from 'react'
import { useMemo } from 'react'
import { FieldRenderer } from '../fields/FieldRenderer.js'
import { LoadingSpinner } from '../LoadingSpinner.js'
import { Button } from '../../primitives/button.js'
import type { FieldConfig } from '@opensaas/stack-core'
import { serializeFieldConfigs } from '../../lib/serializeFieldConfig.js'
import { useItemForm } from '../../lib/useItemForm.js'

export interface ItemCreateFormProps<TData = Record<string, unknown>> {
  fields: Record<string, FieldConfig>
  onSubmit: (data: TData) => Promise<{ success: boolean; error?: string }>
  onCancel?: () => void
  relationshipData?: Record<string, Array<{ id: string; label: string }>>
  submitLabel?: string
  cancelLabel?: string
  className?: string
}

/**
 * Standalone form component for creating items
 * Can be embedded in any custom page
 *
 * @example
 * ```tsx
 * <ItemCreateForm
 *   fields={config.lists.Post.fields}
 *   onSubmit={async (data) => {
 *     const result = await createPost(data);
 *     return { success: !!result };
 *   }}
 *   onCancel={() => router.back()}
 * />
 * ```
 */
export function ItemCreateForm<TData = Record<string, unknown>>({
  fields,
  onSubmit,
  onCancel,
  relationshipData = {},
  submitLabel = 'Create',
  cancelLabel = 'Cancel',
  className,
}: ItemCreateFormProps<TData>) {
  // Serialize field configs to remove non-serializable properties
  const serializedFields = useMemo(() => serializeFieldConfigs(fields), [fields])

  const {
    formData,
    errors,
    generalError,
    isPending,
    editableFields,
    handleFieldChange,
    handleSubmit,
  } = useItemForm({
    fields: serializedFields,
    mode: 'create',
    errorFallback: 'Failed to create item',
    onSubmit: async (data) => {
      const result = await onSubmit(data as TData)
      return result.success
        ? { success: true }
        : { success: false, error: result.error || 'Failed to create item' }
    },
  })

  return (
    <form onSubmit={handleSubmit} className={className}>
      {/* General Error */}
      {generalError && (
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-4 mb-6">
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
            value={(formData as Record<string, unknown>)[fieldName]}
            onChange={(value) => handleFieldChange(fieldName, value)}
            error={errors[fieldName]}
            disabled={isPending}
            mode="edit"
            relationshipItems={relationshipData[fieldName] || []}
            relationshipLoading={false}
          />
        ))}
      </div>

      {/* Form Actions */}
      <div className="flex gap-3 pt-6 mt-6 border-t border-border">
        <Button type="submit" disabled={isPending} className="gap-2">
          {isPending && (
            <LoadingSpinner size="sm" className="border-primary-foreground border-t-transparent" />
          )}
          {isPending ? 'Creating...' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
        )}
      </div>
    </form>
  )
}
