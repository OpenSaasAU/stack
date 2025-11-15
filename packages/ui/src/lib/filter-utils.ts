/**
 * Utilities for managing filter state in URLs and converting to Prisma filters
 */

import type { FilterCondition, FilterOperator, ListFilters } from './filter-types.js'

/**
 * Parse filters from URL search params
 * Format: filters[fieldName][operator]=value
 *
 * @example
 * parseFiltersFromURL('filters[title][contains]=hello&filters[status][equals]=published')
 * // Returns: [
 * //   { field: 'title', operator: 'contains', value: 'hello' },
 * //   { field: 'status', operator: 'equals', value: 'published' }
 * // ]
 */
export function parseFiltersFromURL(
  searchParams: Record<string, string | string[] | undefined>,
): ListFilters {
  const filters: ListFilters = []

  // Parse filters[fieldName][operator]=value format
  for (const [key, value] of Object.entries(searchParams)) {
    // Match pattern: filters[fieldName][operator]
    const match = key.match(/^filters\[([^\]]+)\]\[([^\]]+)\]$/)
    if (match && value !== undefined) {
      const [, field, operator] = match

      // Handle array values (for 'in' and 'notIn' operators)
      let parsedValue: string | string[] | boolean | number
      if (Array.isArray(value)) {
        parsedValue = value
      } else if (operator === 'in' || operator === 'notIn') {
        // Split comma-separated values for 'in' operators
        parsedValue = value.split(',').map((v) => v.trim())
      } else if (operator === 'is') {
        // Parse boolean for checkbox fields
        parsedValue = value === 'true'
      } else if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
        // Try to parse as number for numeric operators
        const num = Number(value)
        parsedValue = isNaN(num) ? value : num
      } else {
        parsedValue = value
      }

      filters.push({
        field,
        operator: operator as FilterOperator,
        value: parsedValue,
      })
    }
  }

  return filters
}

/**
 * Serialize filters to URL search params
 *
 * @example
 * serializeFiltersToURL([
 *   { field: 'title', operator: 'contains', value: 'hello' },
 *   { field: 'status', operator: 'equals', value: 'published' }
 * ])
 * // Returns: 'filters[title][contains]=hello&filters[status][equals]=published'
 */
export function serializeFiltersToURL(filters: ListFilters): string {
  const params = new URLSearchParams()

  for (const filter of filters) {
    const key = `filters[${filter.field}][${filter.operator}]`

    if (Array.isArray(filter.value)) {
      // Join array values with commas
      params.set(key, filter.value.join(','))
    } else {
      params.set(key, String(filter.value))
    }
  }

  return params.toString()
}

/**
 * Convert filters to Prisma where clause
 *
 * @example
 * filtersToPrismaWhere([
 *   { field: 'title', operator: 'contains', value: 'hello' },
 *   { field: 'status', operator: 'equals', value: 'published' },
 *   { field: 'views', operator: 'gt', value: 100 }
 * ])
 * // Returns: {
 * //   AND: [
 * //     { title: { contains: 'hello' } },
 * //     { status: { equals: 'published' } },
 * //     { views: { gt: 100 } }
 * //   ]
 * // }
 */
export function filtersToPrismaWhere(filters: ListFilters): Record<string, unknown> | undefined {
  if (filters.length === 0) {
    return undefined
  }

  const conditions = filters.map((filter) => {
    const { field, operator, value } = filter

    // Handle special operators
    if (operator === 'is') {
      // For checkbox fields: { field: value }
      return { [field]: value }
    }

    if (operator === 'not') {
      // For 'not equals': { field: { not: value } }
      return { [field]: { not: value } }
    }

    // Standard operators map directly to Prisma
    return {
      [field]: {
        [operator]: value,
      },
    }
  })

  // Combine all conditions with AND
  if (conditions.length === 1) {
    return conditions[0]
  }

  return {
    AND: conditions,
  }
}

/**
 * Add or update a filter in the list
 */
export function addFilter(
  filters: ListFilters,
  field: string,
  operator: FilterOperator,
  value: string | string[] | boolean | number,
): ListFilters {
  // Remove existing filter for this field+operator
  const filtered = filters.filter((f) => !(f.field === field && f.operator === operator))

  // Add new filter
  return [...filtered, { field, operator, value }]
}

/**
 * Remove a filter from the list
 */
export function removeFilter(
  filters: ListFilters,
  field: string,
  operator: FilterOperator,
): ListFilters {
  return filters.filter((f) => !(f.field === field && f.operator === operator))
}

/**
 * Remove all filters for a specific field
 */
export function removeFieldFilters(filters: ListFilters, field: string): ListFilters {
  return filters.filter((f) => f.field !== field)
}

/**
 * Get all filters for a specific field
 */
export function getFieldFilters(filters: ListFilters, field: string): ListFilters {
  return filters.filter((f) => f.field === field)
}

/**
 * Clear all filters
 */
export function clearFilters(): ListFilters {
  return []
}
