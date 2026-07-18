import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

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
