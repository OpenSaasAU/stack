'use client'

import * as React from 'react'
import { useState, useTransition } from 'react'
import { unstable_rethrow, useRouter } from 'next/navigation.js'
import { FieldRenderer } from './fields/FieldRenderer.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { LoadingSpinner } from './LoadingSpinner.js'
import { Button } from '../primitives/button.js'
import type { ServerActionInput } from '../server/types.js'
import type { SerializableFieldConfig } from '../lib/serializeFieldConfig.js'
import { FieldValidityContext } from '../lib/fieldValidity.js'
import { useItemForm, type ItemFormSubmitResult } from '../lib/useItemForm.js'
import { useUnsavedChangesGuard } from '../lib/useUnsavedChangesGuard.js'
import { queueSaveNotice } from './SaveNotice.js'
import { applyEdgeWrites } from '../lib/applyEdgeWrites.js'
import { handOffStatus } from '../lib/useBulkStatus.js'
import { formatListName } from '../lib/utils.js'

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
  /**
   * `'read'` renders every field read-only with no Save/Cancel, resolved
   * server-side from `ui.itemView.defaultFieldMode`. Only applies in edit mode.
   * Defaults to `'edit'`.
   */
  fieldMode?: 'edit' | 'read'
  /** A singleton returns to its own editor, which shows no list status. */
  singleton?: boolean
  /** The item's label, which names it in the delete confirmation. */
  itemLabel?: string
}

const UNREACHABLE_SAVE =
  "Couldn't reach the server. Your changes may or may not have been saved, so reload to check before trying again."
const UNREACHABLE_DELETE =
  "Couldn't reach the server. The item may or may not have been deleted, so reload to check before trying again."

async function reachServer(
  call: () => Promise<unknown>,
  unreachable: string,
): Promise<ItemFormSubmitResult | { reached: true; result: unknown }> {
  try {
    return { reached: true, result: await call() }
  } catch (error) {
    unstable_rethrow(error)
    return { success: false, error: unreachable }
  }
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
  fieldMode = 'edit',
  singleton = false,
  itemLabel,
}: ItemFormClientProps) {
  const router = useRouter()
  const closeAfterSave = React.useRef(false)
  const listHref = `${basePath}/${urlKey}`
  const listName = formatListName(listKey)
  const stayAfterSave = mode === 'edit' && !singleton
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // Separate transition for delete (not a form submit, so outside the engine).
  const [isDeleting, startDeleteTransition] = useTransition()

  const {
    formData,
    errors,
    generalError,
    isPending,
    isDirty,
    editableFields,
    handleFieldChange,
    handleSubmit,
    setGeneralError,
    validity,
    formRef,
    errorBannerRef,
  } = useItemForm({
    fields,
    initialData,
    mode: mode === 'create' ? 'create' : 'update',
    errorFallback: 'Access denied or operation failed',
    onEdgeWrites: (changes) => applyEdgeWrites({ changes, parentId: itemId ?? '', serverAction }),
    onUnchanged: ({ edgesCommitted }) => {
      if (stayAfterSave && !closeAfterSave.current) {
        queueSaveNotice(edgesCommitted ? 'Saved.' : 'No changes to save.')
        if (edgesCommitted) router.refresh()
        return
      }
      if (edgesCommitted) {
        if (singleton) queueSaveNotice('Saved.')
        else handOffStatus(listKey, 'Changes saved')
      }
      router.push(listHref)
      router.refresh()
    },
    onSubmit: async (data, action) => {
      const reached = await reachServer(
        () =>
          action === 'create'
            ? serverAction({ listKey, action: 'create', data })
            : serverAction({ listKey, action: 'update', id: itemId!, data }),
        UNREACHABLE_SAVE,
      )
      if (!('reached' in reached)) return reached

      const normalized = toSubmitResult(reached.result, 'Access denied or operation failed')
      if (!normalized.success) return normalized
      if (stayAfterSave && !closeAfterSave.current) {
        queueSaveNotice('Saved.')
        router.refresh()
        return normalized
      }
      if (singleton) queueSaveNotice(action === 'create' ? 'Created.' : 'Saved.')
      else handOffStatus(listKey, action === 'create' ? 'Item created' : 'Changes saved')
      router.push(listHref)
      router.refresh()
      return normalized
    },
  })

  const readOnlyForm = mode === 'edit' && fieldMode === 'read'
  const guard = useUnsavedChangesGuard(isDirty && !readOnlyForm, (href) => router.push(href))

  const handleDelete = () => {
    if (!itemId) return
    setGeneralError(null)
    setShowDeleteConfirm(false)

    startDeleteTransition(async () => {
      const reached = await reachServer(
        () => serverAction({ listKey, action: 'delete', id: itemId }),
        UNREACHABLE_DELETE,
      )
      const normalized =
        'reached' in reached
          ? toSubmitResult(reached.result, 'Access denied or failed to delete item')
          : reached
      if (normalized.success) {
        handOffStatus(listKey, 'Item deleted')
        router.push(listHref)
        router.refresh()
      } else {
        setGeneralError(normalized.error)
      }
    })
  }

  const busy = isPending || isDeleting
  const readOnly = mode === 'edit' && fieldMode === 'read'

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        if (!readOnly) return handleSubmit(event)
        event.preventDefault()
        event.stopPropagation()
      }}
      className="space-y-6"
    >
      {generalError && (
        <div
          ref={errorBannerRef}
          role="alert"
          tabIndex={-1}
          className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-4 outline-none"
        >
          <p className="text-sm font-medium">{generalError}</p>
        </div>
      )}

      <div className="space-y-6">
        <FieldValidityContext value={validity}>
          {editableFields.map(([fieldName, fieldConfig]) => (
            <FieldRenderer
              key={fieldName}
              fieldName={fieldName}
              fieldConfig={fieldConfig}
              value={formData[fieldName]}
              onChange={(value) => handleFieldChange(fieldName, value)}
              error={errors[fieldName]}
              disabled={busy}
              mode={readOnly ? 'read' : 'edit'}
              relationshipItems={relationshipData[fieldName] || []}
              relationshipLoading={false}
              basePath={basePath}
              listKey={listKey}
              serverAction={serverAction}
            />
          ))}
        </FieldValidityContext>
      </div>

      <div className="flex items-center justify-between pt-6 border-t border-border max-md:flex-wrap max-md:gap-3">
        {readOnly ? (
          <div />
        ) : (
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={busy}
              className="gap-2"
              onClick={() => {
                closeAfterSave.current = false
              }}
            >
              {isPending && (
                <LoadingSpinner
                  size="sm"
                  className="border-primary-foreground border-t-transparent"
                />
              )}
              {isPending
                ? mode === 'create'
                  ? 'Creating…'
                  : 'Saving…'
                : mode === 'create'
                  ? 'Create'
                  : 'Save'}
            </Button>
            {stayAfterSave && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  closeAfterSave.current = true
                  formRef.current?.requestSubmit()
                }}
              >
                Save and close
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => guard.requestLeave(listHref)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        )}

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

      <ConfirmDialog
        isOpen={guard.prompt.isOpen}
        title="Discard unsaved changes?"
        message="You have unsaved changes. If you leave this page they will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="warning"
        onConfirm={guard.prompt.onConfirm}
        onCancel={guard.prompt.onCancel}
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={`Delete this ${listName}?`}
        message={
          itemLabel
            ? `“${itemLabel}” will be permanently deleted. This cannot be undone.`
            : `This ${listName} will be permanently deleted. This cannot be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </form>
  )
}
