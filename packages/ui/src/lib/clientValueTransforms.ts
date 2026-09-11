import type { FieldConfig } from '@opensaas/stack-core'

/**
 * Apply each field's `ui.valueForClientSerialization` to one record's values.
 *
 * A field declaring that transform is saying what the browser may have of its
 * value, so it has to run on every path that crosses the server/client
 * boundary — the list table serialises whole rows, not only the columns it
 * renders, so a field withheld from the default columns still reaches the page
 * without this.
 *
 * Operates on the original (non-serialised) field configs: serialisation
 * strips the transform, since a function cannot cross the boundary itself.
 */
export function applyClientValueTransforms(
  fields: Record<string, FieldConfig>,
  record: Record<string, unknown>,
): Record<string, unknown> {
  let result = record

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    const transform = fieldConfig.ui?.valueForClientSerialization
    if (typeof transform !== 'function') continue
    if (result === record) result = { ...record }
    result[fieldName] = transform({ value: result[fieldName] })
  }

  return result
}
