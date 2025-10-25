'use client'

import * as React from 'react'
import { useState, useMemo } from 'react'
import { FieldRenderer } from '../fields/FieldRenderer.js'
import { LoadingSpinner } from '../LoadingSpinner.js'
import { Button } from '../../primitives/button.js'
import type { FieldConfig } from '@opensaas/stack-core'
import { serializeFieldConfigs } from '../../lib/serializeFieldConfig.js'

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
  const transformedInitialData = useMemo(() => {
    const transformed = { ...initialData }
    for (const [fieldName, fieldConfig] of Object.entries(fields)) {
      const fieldConfigAny = fieldConfig as { ui?: Record<string, unknown> }
      if (
        fieldConfigAny.ui?.valueForClientSerialization &&
        typeof fieldConfigAny.ui.valueForClientSerialization === 'function'
      ) {
        const transformer = fieldConfigAny.ui.valueForClientSerialization as (args: {
          value: unknown
        }) => unknown
        transformed[fieldName as keyof TData] = transformer({
          value: transformed[fieldName as keyof TData],
        }) as TData[keyof TData]
      }
    }
    return transformed
  }, [initialData, fields])

  const [isPending, setIsPending] = useState(false)
  const [formData, setFormData] = useState<TData>(transformedInitialData)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)

  const handleFieldChange = (fieldName: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }) as TData)
    // Clear error for this field when user starts typing
    if (errors[fieldName]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[fieldName]
        return newErrors
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    setGeneralError(null)
    setIsPending(true)

    try {
      // Transform relationship fields to Prisma format
      // Filter out password fields with isSet objects (unchanged passwords)
      const transformedData: Record<string, unknown> = {}
      for (const [fieldName, value] of Object.entries(formData as Record<string, unknown>)) {
        const fieldConfig = serializedFields[fieldName]

        // Skip password fields that have { isSet: boolean } value (not being changed)
        if (typeof value === 'object' && value !== null && 'isSet' in value) {
          continue
        }

        // Transform relationship fields
        if (fieldConfig?.type === 'relationship') {
          if (fieldConfig.many) {
            // Many relationship: use connect format
            if (Array.isArray(value) && value.length > 0) {
              transformedData[fieldName] = {
                connect: value.map((id: string) => ({ id })),
              }
            }
          } else {
            // Single relationship: use connect format
            if (value) {
              transformedData[fieldName] = {
                connect: { id: value },
              }
            }
          }
        } else {
          // Non-relationship field: pass through
          transformedData[fieldName] = value
        }
      }

      const result = await onSubmit(transformedData as TData)

      if (!result.success) {
        setGeneralError(result.error || 'Failed to update item')
      }
    } catch (error: unknown) {
      setGeneralError((error as Error).message || 'Failed to update item')
    } finally {
      setIsPending(false)
    }
  }

  // Filter out system fields
  const editableFields = Object.entries(serializedFields).filter(
    ([key]) => !['id', 'createdAt', 'updatedAt'].includes(key),
  )

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
