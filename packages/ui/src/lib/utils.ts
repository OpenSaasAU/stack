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
 * Get the display value for a field
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
    case 'relationship':
      return getRelationshipDisplayValue(value)
    default:
      return String(value)
  }
}

/**
 * Get display value for a relationship field
 * Tries to display: name → title → label → id
 */
function getRelationshipDisplayValue(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '-'
  }

  // Handle array of relationships (many: true)
  if (Array.isArray(value)) {
    if (value.length === 0) return '-'
    return value.map((item) => getRelationshipDisplayValue(item)).join(', ')
  }

  // Handle single relationship object
  let displayValue: unknown
  if ('name' in value) {
    displayValue = value.name
  } else if ('title' in value) {
    displayValue = value.title
  } else if ('label' in value) {
    displayValue = value.label
  } else if ('id' in value) {
    displayValue = value.id
  }

  return displayValue ? String(displayValue) : '-'
}
