'use client'

import * as React from 'react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FieldRenderer } from './fields/FieldRenderer.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { LoadingSpinner } from './LoadingSpinner.js'
import { Button } from '../primitives/button.js'
import type { FieldConfig } from '@opensaas/framework-core'
import type { ServerActionInput } from '../server/types.js'

export interface ItemFormClientProps {
  listKey: string
  urlKey: string
  mode: 'create' | 'edit'
  fields: Record<string, FieldConfig>
  initialData?: Record<string, any>
  itemId?: string
  basePath: string
  serverAction: (input: ServerActionInput) => Promise<any>
  relationshipData?: Record<string, Array<{ id: string; label: string }>>
}

/**
 * Client component for interactive form
 * Handles form state, validation, and submission
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
}: ItemFormClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [formData, setFormData] = useState<Record<string, any>>(initialData)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }))
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

    startTransition(async () => {
      try {
        // Transform relationship fields to Prisma format
        const transformedData: Record<string, any> = {}
        for (const [fieldName, value] of Object.entries(formData)) {
          const fieldConfig = fields[fieldName]

          // Transform relationship fields
          if ((fieldConfig as any)?.type === 'relationship') {
            if ((fieldConfig as any).many) {
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

        const result = await serverAction({
          listKey,
          action: mode === 'create' ? 'create' : 'update',
          data: transformedData,
          id: itemId,
        })

        if (result) {
          // Navigate back to list view
          router.push(`${basePath}/${urlKey}`)
          router.refresh()
        } else {
          setGeneralError('Access denied or operation failed')
        }
      } catch (error: any) {
        setGeneralError(error.message || 'Failed to save item')
      }
    })
  }

  const handleDelete = async () => {
    if (!itemId) return

    setGeneralError(null)
    setShowDeleteConfirm(false)

    startTransition(async () => {
      try {
        const result = await serverAction({
          listKey,
          action: 'delete',
          id: itemId,
        })

        if (result) {
          router.push(`${basePath}/${urlKey}`)
          router.refresh()
        } else {
          setGeneralError('Access denied or failed to delete item')
        }
      } catch (error: any) {
        setGeneralError(error.message || 'Failed to delete item')
      }
    })
  }

  // Filter out system fields
  const editableFields = Object.entries(fields).filter(
    ([key]) => !['id', 'createdAt', 'updatedAt'].includes(key),
  )

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
            disabled={isPending}
            mode="edit"
            relationshipItems={relationshipData[fieldName] || []}
            relationshipLoading={false}
          />
        ))}
      </div>

      {/* Form Actions */}
      <div className="flex items-center justify-between pt-6 border-t border-border">
        <div className="flex gap-3">
          <Button type="submit" disabled={isPending} className="gap-2">
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
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>

        {/* Delete Button (Edit Mode Only) */}
        {mode === 'edit' && itemId && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isPending}
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
