import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { SerializableFieldConfig } from './serializeFieldConfig.js'

/**
 * Merge Tailwind CSS classes with clsx
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a list name for display (PascalCase → Title Case)
 */
export function formatListName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/^./, (str) => str.toUpperCase())
}

/**
 * Format a field name for display (camelCase → Title Case)
 */
export function formatFieldName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

/**
 * Field types whose values are numeric. Numeric columns render right-aligned
 * with tabular numerals so digits line up down the column (issue #710).
 */
const NUMERIC_FIELD_TYPES = new Set(['integer', 'float', 'decimal', 'bigint'])

/**
 * Whether a column of the given field type should be treated as numeric for
 * table alignment (right-aligned cells and headers).
 */
export function isNumericField(fieldType: string | undefined): boolean {
  return fieldType !== undefined && NUMERIC_FIELD_TYPES.has(fieldType)
}

/**
 * Whether a to-many relationship column renders a count (issue #732). Such a
 * column shows the access-visible related count as a number, so it aligns and
 * sorts like a numeric column rather than rendering related labels.
 */
export function isToManyRelationshipColumn(field: SerializableFieldConfig | undefined): boolean {
  return field?.type === 'relationship' && field.many === true
}

/**
 * Whether a column renders numerically for table alignment — a scalar numeric
 * field, or a to-many relationship count column (issue #732).
 */
export function isCountAlignedColumn(field: SerializableFieldConfig | undefined): boolean {
  return isNumericField(field?.type) || isToManyRelationshipColumn(field)
}

/**
 * Whether a column exposes a sort affordance (issue #732).
 *
 * - Virtual fields have no database column to order by → not sortable.
 * - A to-one relationship has no scalar to order by → not sortable.
 * - A to-many relationship sorts by its related count → sortable.
 * - Every other (scalar) column sorts by its own value → sortable.
 */
export function isSortableColumn(field: SerializableFieldConfig | undefined): boolean {
  if (!field) return true
  if (field.virtual === true) return false
  if (field.type === 'relationship') return field.many === true
  return true
}

/**
 * Get the display value for a scalar field.
 *
 * Relationship fields are not handled here — their label is resolved via the
 * shared label seam (`getItemLabel`) by the component that has access to the
 * related list's config (see `ListView.tsx`), not derived from the raw value.
 */
export function getFieldDisplayValue(value: unknown, fieldType: string): string {
  if (value === null || value === undefined) {
    return '-'
  }

  switch (fieldType) {
    case 'checkbox':
      return value ? 'Yes' : 'No'
    case 'timestamp':
      return new Date(value as string | number | Date).toLocaleString()
    case 'password':
      return '••••••••'
    default:
      return String(value)
  }
}
