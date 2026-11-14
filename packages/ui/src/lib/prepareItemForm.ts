import {
  type AccessContext,
  getRelationshipOptions,
  isRelationshipLabelReadable,
  OpenSaasConfig,
} from '@opensaas/stack-core'
import type { ListConfig } from '@opensaas/stack-core'
import type { SerializableFieldConfig } from './serializeFieldConfig.js'
import {
  formValuesForSession,
  readSessionVocabulary,
  serializeFieldsForSession,
  withheldFieldNames,
} from './sessionFieldConfigs.js'

/**
 * One record's id as the string the client form carries. An `int autoincrement`
 * list's id arrives as a number (ADR-0048); the server action's id boundary
 * parses each string back to its own list's key type.
 */
function readId(record: unknown): string | null {
  if (!record || typeof record !== 'object' || !('id' in record)) return null
  const id: unknown = record.id
  if (typeof id === 'string') return id
  return typeof id === 'number' ? String(id) : null
}

/**
 * Extract the currently-selected id(s) from a hydrated relationship value so
 * they can be unioned into the bounded options fetch (the item's current
 * value must always resolve a label, even outside the window).
 */
function extractSelectedIds(value: unknown, many: boolean | undefined): string[] {
  if (many) {
    return Array.isArray(value) ? value.map(readId).filter((id): id is string => id !== null) : []
  }
  const id = readId(value)
  return id === null ? [] : [id]
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

/** The relation names an item form's own read reaches, one hop each. */
export function buildRelationshipInclude(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  listConfig: ListConfig<any>,
): string[] {
  return Object.entries(listConfig.fields)
    .filter(([, fieldConfig]) => (fieldConfig as { type: string }).type === 'relationship')
    .map(([fieldName]) => fieldName)
}

/**
 * Prepare the serializable props for `ItemFormClient` from an already-fetched
 * record (or an empty object for create).
 *
 * This is shared by `ItemForm` (which fetches through the composed read) and
 * `SingletonView` (which resolves via the singleton `get()`), so the
 * relationship/serialization logic lives in exactly one place.
 *
 * `operation` is the write this form performs: a field the session's Session
 * vocabulary denies for it is marked read-only, and a field it can never read
 * is withheld unless the form may write it.
 */
export async function prepareItemForm(
  context: AccessContext,
  config: OpenSaasConfig,
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over TypeInfo
  listConfig: ListConfig<any>,
  itemData: Record<string, unknown>,
  operation: 'create' | 'update',
): Promise<PreparedItemForm> {
  const vocabularyPromise = readSessionVocabulary(context, listKey)
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
        const [vocabulary, labelReadable] = await Promise.all([
          vocabularyPromise,
          isRelationshipLabelReadable(context, config, relatedListName),
        ])
        if (withheldFieldNames(vocabulary, [fieldName], operation).has(fieldName)) return null
        const options = await getRelationshipOptions(context, config, relatedListName, {
          labelReadable,
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

  const vocabulary = await vocabularyPromise
  const { fields: serializableFields } = serializeFieldsForSession({
    vocabulary,
    config,
    listKey,
    fields: listConfig.fields,
    purpose: operation,
    itemId: readId(itemData),
  })

  const formData = { ...itemData }
  for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
    const fieldConfigAny = fieldConfig as {
      type: string
      many?: boolean
    }
    if (fieldConfigAny.type === 'relationship' && formData[fieldName]) {
      const value = formData[fieldName]
      if (fieldConfigAny.many && Array.isArray(value)) {
        formData[fieldName] = value.map(readId).filter((id): id is string => id !== null)
      } else {
        const id = readId(value)
        if (id !== null) formData[fieldName] = id
      }
    }
  }

  const initialData = formValuesForSession({
    vocabulary,
    fields: listConfig.fields,
    values: formData,
    purpose: operation,
  })

  return { serializableFields, initialData, relationshipData }
}
