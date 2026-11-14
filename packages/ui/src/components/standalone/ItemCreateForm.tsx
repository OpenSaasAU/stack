'use client'

import * as React from 'react'
import { FieldRenderer } from '../fields/FieldRenderer.js'
import { LoadingSpinner } from '../LoadingSpinner.js'
import { Button } from '../../primitives/button.js'
import type { SerializableFieldConfig } from '../../lib/serializeFieldConfig.js'
import { useItemForm } from '../../lib/useItemForm.js'
import { FieldValidityContext } from '../../lib/fieldValidity.js'
import { cn } from '../../lib/utils.js'
import type { ItemFormClassNames } from './form-classnames.js'

export interface ItemCreateFormProps<TData = Record<string, unknown>> {
  /**
   * The list's field configs from `serializeFieldConfigs(context, listKey, 'create')`
   * on `@opensaas/stack-ui/server`, which withholds what the session can never
   * read and marks what it can never write.
   */
  fields: Record<string, SerializableFieldConfig>
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
 * @example
 * ```tsx
 * <ItemCreateForm
 *   fields={fields} // await serializeFieldConfigs(context, 'Post', 'create') on the server
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
  const {
    formData,
    errors,
    generalError,
    isPending,
    editableFields,
    handleFieldChange,
    handleSubmit,
    validity,
    formRef,
    errorBannerRef,
  } = useItemForm({
    fields,
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
      ref={formRef}
      noValidate
      data-slot="item-create-form"
      onSubmit={handleSubmit}
      className={cn(className, classNames?.root)}
    >
      {generalError && (
        <div
          ref={errorBannerRef}
          role="alert"
          tabIndex={-1}
          data-slot="form-error"
          className={cn(
            'bg-destructive/10 border border-destructive text-destructive rounded-lg p-4 mb-6 outline-none',
            classNames?.error,
          )}
        >
          <p className="text-sm font-medium">{generalError}</p>
        </div>
      )}

      <div data-slot="form-fields" className={cn('space-y-6', classNames?.fields)}>
        <FieldValidityContext value={validity}>
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
        </FieldValidityContext>
      </div>

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
