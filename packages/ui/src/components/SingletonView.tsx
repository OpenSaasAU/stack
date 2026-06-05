import * as React from 'react'
import Link from 'next/link.js'
import { ItemFormClient } from './ItemFormClient.js'
import { formatListName } from '../lib/utils.js'
import type { ServerActionInput } from '../server/types.js'
import { type AccessContext, getDbKey, getUrlKey, OpenSaasConfig } from '@opensaas/stack-core'
import { prepareItemForm } from '../lib/prepareItemForm.js'
import { isOperationPotentiallyAllowed } from '../lib/operationAccess.js'

export interface SingletonViewProps {
  context: AccessContext<unknown>
  config: OpenSaasConfig
  listKey: string
  basePath?: string
  // Server action can return any shape depending on the list item type
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

/**
 * Singleton editor — renders a single-record edit form for a list configured
 * with `isSingleton: true`.
 *
 * Resolves the record via the singleton `get()` operation (which auto-creates
 * the row with field defaults when absent, unless `autoCreate: false`), then
 * reuses the same `ItemFormClient` + serialization path as `ItemForm` so the
 * existing field rendering, validation, and `serverAction` save flow apply.
 *
 * A `null` from `get()` is ambiguous at the boundary — it means EITHER an
 * `autoCreate: false` singleton with no row yet, OR that `query` access is
 * denied (access-controlled reads return null/[] silently). We disambiguate
 * using the list's operation-level access:
 *
 * - `query` denied  → friendly "no access" message (never an editable form).
 * - `query` allowed + `create` allowed → a create-on-first-save form
 *   (`ItemFormClient` in `mode="create"`); core assigns the singleton `id` and
 *   enforces the single-record constraint on create.
 * - `query` allowed + `create` denied → friendly "no record yet" message.
 *
 * An update-denied singleton still renders the edit form (the happy path), but
 * the save fails gracefully: the server action's `update` access check returns
 * a denied envelope, which `ItemFormClient` surfaces as an error.
 *
 * Server Component that fetches data and sets up actions.
 */
export async function SingletonView({
  context,
  config,
  listKey,
  basePath = '/admin',
  serverAction,
}: SingletonViewProps) {
  const listConfig = config.lists[listKey]
  const urlKey = getUrlKey(listKey)

  if (!listConfig) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2">List not found</h2>
          <p>The list &quot;{listKey}&quot; does not exist in your configuration.</p>
        </div>
      </div>
    )
  }

  // Resolve the singleton record. `get()` auto-creates with field defaults when
  // absent (the default), so a record is the common case. It returns null when
  // either `autoCreate: false` with no row yet, OR `query` access is denied —
  // these are indistinguishable here, so we disambiguate via access below.
  let record: Record<string, unknown> | null = null
  try {
    const delegate = context.db[getDbKey(listKey)]
    if (delegate?.get) {
      record = await delegate.get()
    }
  } catch (error) {
    console.error(`Failed to resolve singleton ${listKey}:`, error)
  }

  if (!record) {
    // A null `get()` is ambiguous (autoCreate:false-empty vs query-denied).
    // Evaluate operation access to choose the safe affordance.
    const accessArgs = { session: context.session, context }
    const canQuery = await isOperationPotentiallyAllowed(
      listConfig.access?.operation,
      'query',
      accessArgs,
    )

    // Query denied → the session cannot read this singleton at all. Show a
    // friendly message; never an editable/create form.
    if (!canQuery) {
      return (
        <div className="p-8 max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{formatListName(listKey)}</h1>
          </div>
          <div className="bg-muted/50 border border-border rounded-lg p-6">
            <p className="text-muted-foreground">
              You don&apos;t have access to {formatListName(listKey)}.
            </p>
          </div>
        </div>
      )
    }

    // Query allowed but no row → an `autoCreate: false` singleton. Offer a
    // create-on-first-save form only when `create` is actually permitted.
    const canCreate = await isOperationPotentiallyAllowed(
      listConfig.access?.operation,
      'create',
      accessArgs,
    )

    if (!canCreate) {
      return (
        <div className="p-8 max-w-4xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">{formatListName(listKey)}</h1>
          </div>
          <div className="bg-muted/50 border border-border rounded-lg p-6">
            <p className="text-muted-foreground">
              There is no {formatListName(listKey)} record yet.
            </p>
          </div>
        </div>
      )
    }

    // Create-on-first-save: render the form in create mode with an empty record.
    // The save goes through the existing `serverAction` create path; core
    // assigns the singleton `id` (always `1`) and enforces the single-record
    // constraint, so the form sends only the user-entered field data.
    const {
      serializableFields: createFields,
      initialData: createInitialData,
      relationshipData: createRelationshipData,
    } = await prepareItemForm(context, config, listConfig, {})

    return (
      <div className="p-8 max-w-4xl">
        {/* Header — a singleton has no list view, so link back to the dashboard. */}
        <div className="mb-8">
          <Link
            href={basePath}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to dashboard
          </Link>
          <h1 className="text-3xl font-bold">Create {formatListName(listKey)}</h1>
        </div>

        {/* Create-on-first-save form */}
        <div className="bg-card border border-border rounded-lg p-6">
          <ItemFormClient
            listKey={listKey}
            urlKey={urlKey}
            mode="create"
            fields={createFields}
            initialData={createInitialData}
            basePath={basePath}
            serverAction={serverAction}
            relationshipData={createRelationshipData}
          />
        </div>
      </div>
    )
  }

  // Reuse the shared field-serialization + relationship-data logic so the
  // singleton editor stays in lockstep with the regular item form.
  const { serializableFields, initialData, relationshipData } = await prepareItemForm(
    context,
    config,
    listConfig,
    record,
  )

  const itemId = record.id as string

  return (
    <div className="p-8 max-w-4xl">
      {/* Header — a singleton has no list view, so link back to the dashboard. */}
      <div className="mb-8">
        <Link
          href={basePath}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to dashboard
        </Link>
        <h1 className="text-3xl font-bold">Edit {formatListName(listKey)}</h1>
      </div>

      {/* Form */}
      <div className="bg-card border border-border rounded-lg p-6">
        <ItemFormClient
          listKey={listKey}
          urlKey={urlKey}
          mode="edit"
          fields={serializableFields}
          initialData={initialData}
          itemId={itemId}
          basePath={basePath}
          serverAction={serverAction}
          relationshipData={relationshipData}
        />
      </div>
    </div>
  )
}
