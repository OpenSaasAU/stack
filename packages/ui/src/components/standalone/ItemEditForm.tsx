'use client'

import * as React from 'react'
import { useMemo } from 'react'
import { FieldRenderer } from '../fields/FieldRenderer.js'
import { LoadingSpinner } from '../LoadingSpinner.js'
import { Button } from '../../primitives/button.js'
import type { FieldConfig } from '@opensaas/stack-core'
import { serializeFieldConfigs } from '../../lib/serializeFieldConfig.js'
import { useItemForm, transformInitialData } from '../../lib/useItemForm.js'

export interface ItemEditFormProps<TData = Record<string, unknown>> {
  fields: Record<string, FieldConfig>
  initialData: TData
  onSubmit: (data: TData) => Promise<{ success: boolean; error?: string }>
  onCancel?: () => void
  relationshipData?: Record<string, Array<{ id: string; label: string }>>
  submitLabel?: string
  cancelLabel?: string
  className?: string
  basePath?: string
}

/**
 * Standalone form component for editing items
 * Can be embedded in any custom page
 *
 * @example
 * ```tsx
 * <ItemEditForm
 *   fields={config.lists.Post.fields}
 *   initialData={post}
 *   onSubmit={async (data) => {
 *     const result = await updatePost(postId, data);
 *     return { success: !!result };
 *   }}
 *   onCancel={() => router.back()}
 * />
 * ```
 */
export function ItemEditForm<TData = Record<string, unknown>>({
  fields,
  initialData,
  onSubmit,
  onCancel,
  relationshipData = {},
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  className,
  basePath = '/admin',
}: ItemEditFormProps<TData>) {
  // Serialize field configs to remove non-serializable properties
  const serializedFields = useMemo(() => serializeFieldConfigs(fields), [fields])

  // Apply valueForClientSerialization transformations to initial data
  const transformedInitialData = useMemo(
    () => transformInitialData(fields, initialData as Record<string, unknown>),
    [initialData, fields],
  )

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
    initialData: transformedInitialData,
    mode: 'update',
    errorFallback: 'Failed to update item',
    onSubmit: async (data) => {
      const result = await onSubmit(data as TData)
      return result.success
        ? { success: true }
        : { success: false, error: result.error || 'Failed to update item' }
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
            basePath={basePath}
          />
        ))}
      </div>

      {/* Form Actions */}
      <div className="flex gap-3 pt-6 mt-6 border-t border-border">
        <Button type="submit" disabled={isPending} className="gap-2">
          {isPending && (
            <LoadingSpinner size="sm" className="border-primary-foreground border-t-transparent" />
          )}
          {isPending ? 'Saving...' : submitLabel}
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
