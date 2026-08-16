import type { ListConfig } from './types.js'

/**
 * Resolve the field name used as a list's Label field: `ui.labelField` if
 * set, else `name`, else `title`, else `id`.
 *
 * @throws if `ui.labelField` names a field not declared on the list, or a
 * relationship field (the Label field must be a scalar).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
export function getLabelFieldName(listConfig: ListConfig<any>): string {
  const configured = listConfig.ui?.labelField

  if (configured !== undefined) {
    const field = listConfig.fields[configured]
    if (!field) {
      throw new Error(
        `ui.labelField "${configured}" does not reference a field declared on this list.`,
      )
    }
    if (field.type === 'relationship') {
      throw new Error(
        `ui.labelField "${configured}" must reference a scalar field, not a relationship.`,
      )
    }
    return configured
  }

  if ('name' in listConfig.fields) return 'name'
  if ('title' in listConfig.fields) return 'title'
  return 'id'
}

/**
 * Render a row's Label field ({@link getLabelFieldName}) as text, falling
 * back to `item.id` when the value is `null`/`undefined`.
 */
export function getItemLabel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  item: Record<string, unknown>,
): string {
  const fieldName = getLabelFieldName(listConfig)
  const value = Object.prototype.hasOwnProperty.call(item, fieldName) ? item[fieldName] : undefined

  if (value === undefined || value === null) {
    return String(item.id)
  }

  return String(value)
}
