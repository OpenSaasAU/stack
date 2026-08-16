import type { ListConfig } from './types.js'

/**
 * Resolve the field name used as a list's Label field — see the "Label
 * field" glossary entry in `CONTEXT.md`.
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
 * Render a row's Label field as text — see the "Item label" glossary entry
 * in `CONTEXT.md`.
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
