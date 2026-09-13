import type { FieldConfig } from '../config/types.js'

/**
 * Whether a field is a to-many relationship — the only field kind that carries a
 * relationship count (a to-one relationship has at most one related row).
 */
export function isToManyRelationshipField(field: FieldConfig | undefined): boolean {
  return (
    field?.type === 'relationship' &&
    'many' in field &&
    field.many === true &&
    'ref' in field &&
    typeof field.ref === 'string' &&
    field.ref.length > 0
  )
}
