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
    default:
      return String(value)
  }
}
