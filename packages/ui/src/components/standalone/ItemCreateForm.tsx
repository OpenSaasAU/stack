'use client'

import * as React from 'react'
import { useState } from 'react'
import { FieldRenderer } from '../fields/FieldRenderer.js'
import { LoadingSpinner } from '../LoadingSpinner.js'
import { Button } from '../../primitives/button.js'
import type { FieldConfig } from '@opensaas/core'

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
  const [isPending, setIsPending] = useState(false)
  const [formData, setFormData] = useState<Partial<TData>>({} as Partial<TData>)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)

  const handleFieldChange = (fieldName: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }) as Partial<TData>)
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
      const transformedData: Record<string, unknown> = {}
      for (const [fieldName, value] of Object.entries(formData as Record<string, unknown>)) {
        const fieldConfig = fields[fieldName]

        // Transform relationship fields
        if ((fieldConfig as Record<string, unknown>)?.type === 'relationship') {
          if ((fieldConfig as Record<string, unknown>).many) {
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
        setGeneralError(result.error || 'Failed to create item')
      }
    } catch (error: unknown) {
      setGeneralError((error as Error).message || 'Failed to create item')
    } finally {
      setIsPending(false)
    }
  }

  // Filter out system fields
  const editableFields = Object.entries(fields).filter(
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
