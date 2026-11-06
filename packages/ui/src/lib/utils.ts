import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { SerializableFieldConfig } from './serializeFieldConfig.js'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatListName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/^./, (str) => str.toUpperCase())
}

export function formatFieldName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

/** The label a form shows for a field: `ui.label`, then `label`, then its formatted name. */
export function resolveFieldLabel(
  fieldName: string,
  fieldConfig?: { label?: string; ui?: { [key: string]: unknown } },
): string {
  const uiLabel = fieldConfig?.ui?.label
  if (typeof uiLabel === 'string' && uiLabel) return uiLabel
  return fieldConfig?.label || formatFieldName(fieldName)
}

/**
 * Field types whose values are numeric. Numeric columns render right-aligned
 * with tabular numerals so digits line up down the column (issue #710).
 */
const NUMERIC_FIELD_TYPES = new Set(['integer', 'float', 'decimal', 'bigint', 'bigInt'])

export function isNumericField(fieldType: string | undefined): boolean {
  return fieldType !== undefined && NUMERIC_FIELD_TYPES.has(fieldType)
}

/**
 * Whether a to-many relationship column renders a count (issue #732). Such a
 * column shows the access-visible related count as a number, so it aligns like
 * a numeric column rather than rendering related labels.
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
