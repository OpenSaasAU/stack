import { type AccessContext, getDbKey, OpenSaasConfig } from '@opensaas/stack-core'
import type { ListConfig } from '@opensaas/stack-core'
import { serializeFieldConfigs, type SerializableFieldConfig } from './serializeFieldConfig.js'

/**
 * Data prepared on the server for the client item form.
 *
 * Everything here is JSON-serializable and contains only what `ItemFormClient`
 * needs to render — see the repo rule on minimal, serializable client props.
 */
export interface PreparedItemForm {
  /** Field configs stripped of functions/non-serializable props. */
  serializableFields: Record<string, SerializableFieldConfig>
  /** Initial form values (relationships reduced to ids, client transforms applied). */
  initialData: Record<string, unknown>
  /** Relationship options keyed by field name. */
  relationshipData: Record<string, Array<{ id: string; label: string }>>
}

/**
 * Build the `include` object needed to hydrate relationship fields when
 * fetching an item for editing.
 */
export function buildRelationshipInclude(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  listConfig: ListConfig<any>,
): Record<string, boolean> {
  const includeRelationships: Record<string, boolean> = {}
  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    if ((fieldConfig as { type: string }).type === 'relationship') {
      includeRelationships[fieldName] = true
    }
  }
  return includeRelationships
}

/**
 * Prepare the serializable props for `ItemFormClient` from an already-fetched
 * record (or an empty object for create).
 *
 * This is shared by `ItemForm` (which fetches via `findUnique`) and
 * `SingletonView` (which resolves via the singleton `get()`), so the
 * relationship/serialization logic lives in exactly one place.
 */
export async function prepareItemForm(
  context: AccessContext<unknown>,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  listConfig: ListConfig<any>,
  itemData: Record<string, unknown>,
): Promise<PreparedItemForm> {
  // Fetch relationship options for all relationship fields
  const relationshipData: Record<string, Array<{ id: string; label: string }>> = {}
  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    const fieldConfigAny = fieldConfig as { type: string; ref?: string }
    if (fieldConfigAny.type === 'relationship') {
      const ref = fieldConfigAny.ref
      if (ref) {
        // Parse ref format: "ListName.fieldName"
        const relatedListName = ref.split('.')[0]
        const relatedListConfig = config.lists[relatedListName]

        if (relatedListConfig) {
          try {
            const delegate = context.db[getDbKey(relatedListName)]
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

  // JSON round-trip ensures only serializable data crosses the client boundary
  const initialData = JSON.parse(JSON.stringify(formData)) as Record<string, unknown>

  return { serializableFields, initialData, relationshipData }
}
