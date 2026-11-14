import * as React from 'react'
import { unstable_rethrow } from 'next/navigation.js'
import { AlertTriangle } from 'lucide-react'
import { resolveListUi } from '../lib/resolveListUi.js'
import { ItemFormClient } from './ItemFormClient.js'
import { formatListName } from '../lib/utils.js'
import { PageHeader } from './PageHeader.js'
import { EmptyState } from './EmptyState.js'
import { UnavailableState } from './UnavailableState.js'
import type { ServerActionInput } from '../server/types.js'
import {
  type AnyStackContext,
  engineContextOf,
  getUrlKey,
  OpenSaasConfig,
  ValidationError,
} from '@opensaas/stack-core'
import { prepareItemForm } from '../lib/prepareItemForm.js'
import type { SessionVocabulary } from '@opensaas/stack-core/internal'
import { vocabularyOrDeny } from '../lib/sessionFieldConfigs.js'

export interface SingletonViewProps {
  context: AnyStackContext
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
 * the row with field defaults when absent, unless `autoCreate: false` or the
 * list's `query` rule answers anything but a strict `true`), then
 * reuses the same `ItemFormClient` + serialization path as `ItemForm` so the
 * existing field rendering, validation, and `serverAction` save flow apply.
 *
 * What the session may do is read from its Session vocabulary, never from
 * the access rules directly:
 *
 * - `query` denied  → a "no access" state, and `get()` is never called.
 * - no record yet, `create` not denied → a create-on-first-save form
 *   (`ItemFormClient` in `mode="create"`); core assigns the singleton `id` and
 *   enforces the single-record constraint on create.
 * - no record yet, `create` denied → a "no record yet" message.
 *
 * An update-denied singleton still renders the edit form (the happy path), but
 * the save fails gracefully: the server action's `update` access check returns
 * a denied envelope, which `ItemFormClient` surfaces as an error.
 */
export async function SingletonView({
  context: appContext,
  config,
  listKey,
  basePath = '/admin',
  serverAction,
}: SingletonViewProps) {
  const context = engineContextOf(appContext)
  const listConfig = Object.hasOwn(config.lists, listKey) ? config.lists[listKey] : undefined
  const urlKey = getUrlKey(listKey)

  if (!listConfig) {
    return (
      <div className="p-4 md:p-8">
        <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
          <h1 className="text-lg font-semibold mb-2">List not found</h1>
          <p>The list &quot;{listKey}&quot; does not exist in your configuration.</p>
        </div>
      </div>
    )
  }

  let vocabulary: SessionVocabulary | null
  try {
    vocabulary = await vocabularyOrDeny(appContext, listKey)
  } catch (error) {
    unstable_rethrow(error)
    console.error(`Failed to read the session vocabulary for ${listKey}:`, error)
    return (
      <div className="max-w-4xl p-4 md:p-8">
        <PageHeader title={formatListName(listKey)} />
        <div role="alert" data-slot="singleton-view-error">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title={`${formatListName(listKey)} could not be loaded`}
            description="Something went wrong while reading it, so it is not shown here. Nothing has been changed."
          />
        </div>
      </div>
    )
  }

  if (vocabulary === null || vocabulary.operations.query === 'deny') {
    return (
      <div className="max-w-4xl p-4 md:p-8">
        <PageHeader title={formatListName(listKey)} />
        <UnavailableState
          slot="singleton-view-unavailable"
          title={`${formatListName(listKey)} can't be shown here.`}
          description={`You don't have access to ${formatListName(listKey)}.`}
        />
      </div>
    )
  }

  let record: Record<string, unknown> | null = null
  try {
    const delegate = context.db[listKey]
    if (delegate?.get) {
      const include: Record<string, boolean> = {}
      for (const [fieldName, field] of Object.entries(listConfig.fields)) {
        if (field.type === 'relationship' && !('many' in field && field.many))
          include[fieldName] = true
      }
      record = await delegate.get({ include })
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      record = null
    } else {
      console.error(`Failed to resolve singleton ${listKey}:`, error)
    }
  }

  if (!record) {
    if (vocabulary.operations.create === 'deny') {
      return (
        <div className="max-w-4xl p-4 md:p-8">
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
    } = await prepareItemForm(context, config, listKey, listConfig, {}, 'create')

    return (
      <div className="max-w-4xl p-4 md:p-8">
        {/* A singleton has no list view, so link back to the dashboard. */}
        <PageHeader
          backHref={basePath}
          backLabel="Back to dashboard"
          title={`Create ${formatListName(listKey)}`}
        />

        <div className="bg-card border border-border rounded-lg p-4 md:p-6">
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
    listKey,
    listConfig,
    record,
    'update',
  )

  const itemId = record.id as string
  const { fieldMode } = await resolveListUi(listConfig, context)

  return (
    <div className="max-w-4xl p-4 md:p-8">
      <PageHeader
        backHref={basePath}
        backLabel="Back to dashboard"
        title={`Edit ${formatListName(listKey)}`}
      />

      <div className="bg-card border border-border rounded-lg p-4 md:p-6">
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
          fieldMode={fieldMode}
        />
      </div>
    </div>
  )
}
