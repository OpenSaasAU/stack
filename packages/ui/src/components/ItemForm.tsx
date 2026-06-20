import * as React from 'react'
import Link from 'next/link.js'
import { ItemFormClient } from './ItemFormClient.js'
import { formatListName } from '../lib/utils.js'
import type { ServerActionInput } from '../server/types.js'
import { type AccessContext, getDbKey, getUrlKey, OpenSaasConfig } from '@opensaas/stack-core'
import { buildRelationshipInclude, prepareItemForm } from '../lib/prepareItemForm.js'

export interface ItemFormProps {
  context: AccessContext<unknown>
  config: OpenSaasConfig
  listKey: string
  mode: 'create' | 'edit'
  itemId?: string
  basePath?: string
  // Server action can return any shape depending on the list item type
  serverAction: (input: ServerActionInput) => Promise<unknown>
}

/**
 * Item form component - create or edit an item
 * Server Component that fetches data and sets up actions
 */
export async function ItemForm({
  context,
  config,
  listKey,
  mode,
  itemId,
  basePath = '/admin',
  serverAction,
}: ItemFormProps) {
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

  // Fetch item data if in edit mode
  let itemData: Record<string, unknown> = {}
  if (mode === 'edit' && itemId) {
    try {
      // Fetch item with relationships included
      const includeRelationships = buildRelationshipInclude(listConfig)
      const delegate = context.db[getDbKey(listKey)]
      if (delegate?.findUnique) {
        itemData = await delegate.findUnique({
          where: { id: itemId },
          ...(Object.keys(includeRelationships).length > 0 && { include: includeRelationships }),
        })
      }
    } catch (error) {
      console.error(`Failed to fetch item ${itemId}:`, error)
    }

    if (!itemData) {
      return (
        <div className="p-8">
          <div className="bg-destructive/10 border border-destructive text-destructive rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-2">Item not found</h2>
            <p>
              The item you&apos;re trying to edit doesn&apos;t exist or you don&apos;t have access
              to it.
            </p>
            <Link
              href={`${basePath}/${urlKey}`}
              className="inline-block mt-4 text-primary hover:underline"
            >
              ← Back to {formatListName(listKey)}
            </Link>
          </div>
        </div>
      )
    }
  }

  // Fetch relationship options, serialize field configs, and transform the
  // record into client-ready form data (shared with the singleton editor).
  const { serializableFields, initialData, relationshipData } = await prepareItemForm(
    context,
    config,
    listConfig,
    itemData,
  )

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`${basePath}/${urlKey}`}
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
          Back to {formatListName(listKey)}
        </Link>
        <h1 className="text-3xl font-bold">
          {mode === 'create' ? 'Create' : 'Edit'} {formatListName(listKey)}
        </h1>
      </div>

      {/* Form */}
      <div className="bg-card border border-border rounded-lg p-6">
        <ItemFormClient
          listKey={listKey}
          urlKey={urlKey}
          mode={mode}
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
