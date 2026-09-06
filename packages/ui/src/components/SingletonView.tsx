import * as React from 'react'
import { ItemFormClient } from './ItemFormClient.js'
import { formatListName } from '../lib/utils.js'
import { PageHeader } from './PageHeader.js'
import type { ServerActionInput } from '../server/types.js'
import { type AccessContext, getUrlKey, OpenSaasConfig } from '@opensaas/stack-core'
import { prepareItemForm } from '../lib/prepareItemForm.js'
import { isOperationPotentiallyAllowed } from '../lib/operationAccess.js'

export interface SingletonViewProps {
  context: AccessContext
  config: OpenSaasConfig
  listKey: string
  basePath?: string
  // See AdminUIProps.serverAction for why this is Promise<unknown>.
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

  // Resolve the singleton record; see the docblock above for what a null
  // `get()` means and how the branches below disambiguate it.
  let record: Record<string, unknown> | null = null
  try {
    const delegate = context.db[listKey]
    if (delegate?.get) {
      record = await delegate.get()
    }
  } catch (error) {
    console.error(`Failed to resolve singleton ${listKey}:`, error)
  }

  if (!record) {
    // Disambiguate via operation-level access (see docblock).
    const accessArgs = { session: context.session, context }
    const canQuery = await isOperationPotentiallyAllowed(
      listConfig.access?.operation,
      'query',
      accessArgs,
    )

    if (!canQuery) {
      return (
        <div className="p-8 max-w-4xl">
          <PageHeader title={formatListName(listKey)} />
          <div className="bg-muted/50 border border-border rounded-lg p-6">
            <p className="text-muted-foreground">
              You don&apos;t have access to {formatListName(listKey)}.
            </p>
          </div>
        </div>
      )
    }

    const canCreate = await isOperationPotentiallyAllowed(
      listConfig.access?.operation,
      'create',
      accessArgs,
    )

    if (!canCreate) {
      return (
        <div className="p-8 max-w-4xl">
          <PageHeader title={formatListName(listKey)} />
          <div className="bg-muted/50 border border-border rounded-lg p-6">
            <p className="text-muted-foreground">
              There is no {formatListName(listKey)} record yet.
            </p>
          </div>
        </div>
      )
    }

    // Core assigns the singleton `id` (always `1`) and enforces the
    // single-record constraint on create, so the form sends only the
    // user-entered field data.
    const {
      serializableFields: createFields,
      initialData: createInitialData,
      relationshipData: createRelationshipData,
    } = await prepareItemForm(context, config, listConfig, {})

    return (
      <div className="p-8 max-w-4xl">
        {/* A singleton has no list view, so link back to the dashboard. */}
        <PageHeader
          backHref={basePath}
          backLabel="Back to dashboard"
          title={`Create ${formatListName(listKey)}`}
        />

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
            canDelete={false}
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
      <PageHeader
        backHref={basePath}
        backLabel="Back to dashboard"
        title={`Edit ${formatListName(listKey)}`}
      />

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
          canDelete={false}
        />
      </div>
    </div>
  )
}
