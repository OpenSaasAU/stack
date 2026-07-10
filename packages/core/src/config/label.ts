import type { ListConfig } from './types.js'

/**
 * Resolve the field name that represents a list's rows as a single label —
 * the projection half of the label seam. `getItemLabel` reads exactly the
 * field this returns, so the field chosen for projection can never drift
 * from the field used for rendering.
 *
 * Fallback order: configured `ui.labelField` → `name` → `title` → `id`
 * (first field that exists on the list).
 *
 * @throws if `ui.labelField` is set but does not reference a declared,
 * non-relationship field on the list.
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
 * Resolve the display label for a single row — the render half of the label
 * seam. Reads the field `getLabelFieldName` resolves, falling back to `id`
 * when that field is missing from the row (e.g. stripped by field-level
 * access).
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
