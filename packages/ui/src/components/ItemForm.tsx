import * as React from 'react'
import Link from 'next/link.js'
import { ItemFormClient } from './ItemFormClient.js'
import { formatListName } from '../lib/utils.js'
import type { ServerActionInput } from '../server/types.js'
import { type AccessContext, getDbKey, getUrlKey, OpenSaasConfig, type PrismaClientLike } from '@opensaas/stack-core'
import { serializeFieldConfigs } from '../lib/serializeFieldConfig.js'

export interface ItemFormProps {
  context: AccessContext<any>
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
      // Build include object for relationships
      const includeRelationships: Record<string, boolean> = {}
      for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
        const fieldConfigAny = fieldConfig as { type: string }
        if (fieldConfigAny.type === 'relationship') {
          includeRelationships[fieldName] = true
        }
      }

      // Fetch item with relationships included
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

  // Fetch relationship options for all relationship fields
  const relationshipData: Record<string, Array<{ id: string; label: string }>> = {}
  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    // Check if field is a relationship type by checking the discriminated union
    const fieldConfigAny = fieldConfig as { type: string; ref?: string }
    if (fieldConfigAny.type === 'relationship') {
      const ref = fieldConfigAny.ref
      if (ref) {
        // Parse ref format: "ListName.fieldName"
        const relatedListName = ref.split('.')[0]
        const relatedListConfig = config.lists[relatedListName]

        if (relatedListConfig) {
          try {
            const dbContext = context.db
            const delegate = dbContext[getDbKey(relatedListName)]
            const relatedItems = delegate?.findMany ? await delegate.findMany({}) : []

            // Use 'name' field as label if it exists, otherwise use 'id'
            relationshipData[fieldName] = relatedItems.map((item: Record<string, unknown>) => ({
              id: item.id as string,
              label: ((item.name || item.title || item.id) as string) || '',
            }))
          } catch (error) {
            console.error(`Failed to fetch relationship items for ${fieldName}:`, error)
            relationshipData[fieldName] = []
          }
        }
      }
    }
  }

  // Serialize field configs to remove non-serializable properties
  const serializableFields = serializeFieldConfigs(listConfig.fields)

  // Transform relationship data in itemData from objects to IDs for form
  // Also apply valueForClientSerialization transformation
  const formData = { ...itemData }
  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    const fieldConfigAny = fieldConfig as {
      type: string
      many?: boolean
      ui?: Record<string, unknown>
    }
    if (fieldConfigAny.type === 'relationship' && formData[fieldName]) {
      const value = formData[fieldName]
      if (fieldConfigAny.many && Array.isArray(value)) {
        // Many relationship: extract IDs from array of objects
        formData[fieldName] = value.map((item: Record<string, unknown>) => item.id as string)
      } else if (value && typeof value === 'object' && 'id' in value) {
        // Single relationship: extract ID from object
        formData[fieldName] = (value as Record<string, unknown>).id as string
      }
    }

    // Apply valueForClientSerialization if defined
    if (
      fieldConfigAny.ui?.valueForClientSerialization &&
      typeof fieldConfigAny.ui.valueForClientSerialization === 'function'
    ) {
      const transformer = fieldConfigAny.ui.valueForClientSerialization as (args: {
        value: unknown
      }) => unknown
      formData[fieldName] = transformer({ value: formData[fieldName] })
    }
  }

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
          initialData={JSON.parse(JSON.stringify(formData))}
          itemId={itemId}
          basePath={basePath}
          serverAction={serverAction}
          relationshipData={relationshipData}
        />
      </div>
    </div>
  )
}
