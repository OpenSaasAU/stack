'use client'

import * as React from 'react'
import { useMemo } from 'react'
import { FieldRenderer } from '../fields/FieldRenderer.js'
import { LoadingSpinner } from '../LoadingSpinner.js'
import { Button } from '../../primitives/button.js'
import type { FieldConfig } from '@opensaas/stack-core'
import { serializeFieldConfigs } from '../../lib/serializeFieldConfig.js'
import { useItemForm } from '../../lib/useItemForm.js'
import { cn } from '../../lib/utils.js'
import type { ItemFormClassNames } from './form-classnames.js'

export interface ItemCreateFormProps<TData = Record<string, unknown>> {
  fields: Record<string, FieldConfig>
  onSubmit: (data: TData) => Promise<{ success: boolean; error?: string }>
  onCancel?: () => void
  relationshipData?: Record<string, Array<{ id: string; label: string }>>
  submitLabel?: string
  cancelLabel?: string
  className?: string
  /** Structured per-part class overrides; each merges onto its `data-slot` part. */
  classNames?: ItemFormClassNames
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
  classNames,
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
    <form
      data-slot="item-create-form"
      onSubmit={handleSubmit}
      className={cn(className, classNames?.root)}
    >
      {/* General Error */}
      {generalError && (
        <div
          data-slot="form-error"
          className={cn(
            'bg-destructive/10 border border-destructive text-destructive rounded-lg p-4 mb-6',
            classNames?.error,
          )}
        >
          <p className="text-sm font-medium">{generalError}</p>
        </div>
      )}

      {/* Form Fields */}
      <div data-slot="form-fields" className={cn('space-y-6', classNames?.fields)}>
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
      <div
        data-slot="form-actions"
        className={cn('flex gap-3 pt-6 mt-6 border-t border-border', classNames?.actions)}
      >
        <Button type="submit" disabled={isPending} className={cn('gap-2', classNames?.submit)}>
          {isPending && (
            <LoadingSpinner size="sm" className="border-primary-foreground border-t-transparent" />
          )}
          {isPending ? 'Creating...' : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={isPending}
            className={classNames?.cancel}
          >
            {cancelLabel}
          </Button>
        )}
      </div>
    </form>
  )
}
