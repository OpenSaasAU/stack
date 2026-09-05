import { type AccessContext, getRelationshipOptions, OpenSaasConfig } from '@opensaas/stack-core'
import type { ListConfig } from '@opensaas/stack-core'
import { serializeFieldConfigs, type SerializableFieldConfig } from './serializeFieldConfig.js'
import { jsonSafeClone } from './jsonSafeClone.js'

/**
 * Extract the currently-selected id(s) from a hydrated relationship value so
 * they can be unioned into the bounded options fetch (the item's current
 * value must always resolve a label, even outside the window).
 */
function extractSelectedIds(value: unknown, many: boolean | undefined): string[] {
  if (many) {
    return Array.isArray(value)
      ? value
          .map((item) => (item as { id?: string })?.id)
          .filter((id): id is string => typeof id === 'string')
      : []
  }
  return value && typeof value === 'object' && 'id' in value ? [(value as { id: string }).id] : []
}

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
  context: AccessContext,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  listConfig: ListConfig<any>,
  itemData: Record<string, unknown>,
): Promise<PreparedItemForm> {
  // Bounded/projected fetch — see getRelationshipOptions.
  const relationshipData: Record<string, Array<{ id: string; label: string }>> = {}
  const relationshipFields = Object.entries(listConfig.fields).filter(
    ([, fieldConfig]) => (fieldConfig as { type: string }).type === 'relationship',
  ) as Array<[string, { type: string; ref?: string; many?: boolean }]>

  const relationshipResults = await Promise.all(
    relationshipFields.map(async ([fieldName, fieldConfigAny]) => {
      const ref = fieldConfigAny.ref
      if (!ref) return null
      // Parse ref format: "ListName.fieldName"
      const relatedListName = ref.split('.')[0]
      if (!config.lists[relatedListName]) return null

      try {
        const options = await getRelationshipOptions(context, config, relatedListName, {
          selectedIds: extractSelectedIds(itemData[fieldName], fieldConfigAny.many),
        })
        return [fieldName, options] as const
      } catch (error) {
        console.error(`Failed to fetch relationship items for ${fieldName}:`, error)
        return [fieldName, []] as const
      }
    }),
  )

  for (const result of relationshipResults) {
    if (result) relationshipData[result[0]] = [...result[1]]
  }

  const serializableFields = serializeFieldConfigs(listConfig.fields)

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
        formData[fieldName] = value.map((item: Record<string, unknown>) => item.id as string)
      } else if (value && typeof value === 'object' && 'id' in value) {
        formData[fieldName] = (value as Record<string, unknown>).id as string
      }
    }

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

  const initialData = jsonSafeClone(formData)

  return { serializableFields, initialData, relationshipData }
}
