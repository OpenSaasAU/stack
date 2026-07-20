'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation.js'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../primitives/dialog.js'
import { Button } from '../primitives/button.js'
import { LoadingSpinner } from './LoadingSpinner.js'
import { FieldRenderer } from './fields/FieldRenderer.js'
import { useItemForm, type ItemFormSubmitResult } from '../lib/useItemForm.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import type { ServerActionInput } from '../server/types.js'

export interface RelationshipCreateDrawerProps {
  /** The related list key — the target of the create-and-link server action. */
  relatedListKey: string
  /** Display name of the related list (e.g. `Post`), used for the button + heading. */
  title: string
  /**
   * Serialised field configs for the related list's create form, already stripped
   * of the back-reference field (which is preset + hidden — set on the server).
   */
  fields: Record<string, SerializableFieldConfig>
  /** Relationship options for the create form's own relationship fields, if any. */
  relationshipData?: Record<string, Array<{ id: string; label: string }>>
  /** The related list's field that points back at the parent record. */
  backReferenceField?: string
  /** The parent record id — the create-and-link target. */
  parentId: string
  /** Admin base path (e.g. `/admin`), for relationship field navigation. */
  basePath: string
  /** Server action that runs the create through the secured context. */
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

/**
 * Read the `{ created, error?, fieldErrors? }` outcome a create-and-link server
 * action returns, mapped onto the shared item-form result shape so the drawer's
 * `useItemForm` engine renders general + per-field errors. An unrecognised shape
 * is a failure — a create must never be reported as succeeded on an odd result.
 */
function readCreateOutcome(result: unknown): ItemFormSubmitResult {
  if (typeof result === 'object' && result !== null && 'created' in result) {
    const record = result as { created?: unknown; error?: unknown; fieldErrors?: unknown }
    if (record.created === true) return { success: true }
    const fieldErrors =
      typeof record.fieldErrors === 'object' && record.fieldErrors !== null
        ? (record.fieldErrors as Record<string, string>)
        : undefined
    return {
      success: false,
      error: typeof record.error === 'string' ? record.error : 'Access denied or create failed',
      fieldErrors,
    }
  }
  return { success: false, error: 'Access denied or create failed' }
}

/**
 * The create form hosted inside the drawer. Split out so it mounts fresh each
 * time the drawer opens (Radix unmounts portalled content on close), which
 * resets `useItemForm` state between opens without a manual reset.
 */
function RelationshipCreateForm({
  relatedListKey,
  fields,
  relationshipData,
  backReferenceField,
  parentId,
  basePath,
  serverAction,
  onCreated,
  onCancel,
}: Omit<RelationshipCreateDrawerProps, 'title'> & {
  onCreated: () => void
  onCancel: () => void
}) {
  const {
    formData,
    errors,
    generalError,
    isPending,
    editableFields,
    handleFieldChange,
    handleSubmit,
  } = useItemForm({
    fields,
    mode: 'create',
    errorFallback: 'Access denied or create failed',
    onSubmit: async (data) => {
      // The back-reference is set on the SERVER from field/parentId (never
      // trusted from the client payload), so the new row links to exactly this
      // parent. The related list's create access + hooks govern the write.
      const result = await serverAction({
        listKey: relatedListKey,
        action: 'createRelated',
        data,
        field: backReferenceField,
        parentId,
      })
      const outcome = readCreateOutcome(result)
      if (outcome.success) onCreated()
      return outcome
    },
  })

  return (
    <form data-slot="relationship-create-form" onSubmit={handleSubmit} className="space-y-6">
      {generalError && (
        <div
          role="alert"
          data-slot="relationship-create-error"
          className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm font-medium text-destructive"
        >
          {generalError}
        </div>
      )}

      <div data-slot="relationship-create-fields" className="space-y-6">
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
            relationshipItems={relationshipData?.[fieldName] || []}
            relationshipLoading={false}
            basePath={basePath}
            listKey={relatedListKey}
            serverAction={serverAction}
          />
        ))}
      </div>

      <div
        data-slot="relationship-create-actions"
        className="flex gap-3 border-t border-border pt-6"
      >
        <Button type="submit" disabled={isPending} className="gap-2">
          {isPending && (
            <LoadingSpinner size="sm" className="border-primary-foreground border-t-transparent" />
          )}
          {isPending ? 'Creating...' : 'Create'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * Pre-linked create drawer (issue #738) — the "+ Add" affordance on a read-only
 * Relationship table. Mounts on the `relationship-table-toolbar` seam #734
 * reserved. Opening it reveals a drawer hosting the related list's create form
 * (via the shared `useItemForm` engine + `FieldRenderer`, so validation and
 * required fields are enforced exactly as the standalone create form). On submit
 * the row is created through the secured context with its back-reference preset
 * to the parent (ADR-0018 — the related list's create access + hooks apply). On
 * success the drawer closes and the table refreshes; the control is only
 * rendered when the session may create on the related list (gated server-side).
 *
 * Accessibility: the Radix `Dialog` provides the focus trap, `Escape`-to-close,
 * and dialog aria wiring; the drawer is a right-anchored panel styled with theme
 * tokens.
 */
export function RelationshipCreateDrawer({
  relatedListKey,
  title,
  fields,
  relationshipData,
  backReferenceField,
  parentId,
  basePath,
  serverAction,
}: RelationshipCreateDrawerProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        data-slot="relationship-table-add"
        onClick={() => setOpen(true)}
      >
        + Add {title}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-slot="relationship-create-drawer"
          className="left-auto right-0 top-0 h-full max-h-none w-full max-w-md translate-x-0 translate-y-0 gap-6 overflow-y-auto rounded-none border-l"
        >
          <DialogHeader>
            <DialogTitle>Add {title}</DialogTitle>
            <DialogDescription>
              Create a new {title.toLowerCase()} linked to this record.
            </DialogDescription>
          </DialogHeader>

          <RelationshipCreateForm
            relatedListKey={relatedListKey}
            fields={fields}
            relationshipData={relationshipData}
            backReferenceField={backReferenceField}
            parentId={parentId}
            basePath={basePath}
            serverAction={serverAction}
            onCreated={() => {
              // In-place: close the drawer and refresh so the re-fetched table
              // shows the new (access-visible) row, preserving nav/filter state.
              setOpen(false)
              router.refresh()
            }}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
