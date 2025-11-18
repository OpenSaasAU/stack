/**
 * Filter types and operator definitions for list filtering
 */

/**
 * Filter operators available for each field type
 */
export type FilterOperator =
  // Text operators
  | 'contains'
  | 'equals'
  | 'startsWith'
  | 'endsWith'
  | 'not'
  // Number operators
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  // Array operators
  | 'in'
  | 'notIn'
  // Boolean operators
  | 'is'

/**
 * Filter operators by field type
 */
export const FIELD_TYPE_OPERATORS: Record<string, FilterOperator[]> = {
  text: ['contains', 'equals', 'startsWith', 'endsWith', 'not'],
  integer: ['equals', 'gt', 'gte', 'lt', 'lte', 'not'],
  checkbox: ['is'],
  timestamp: ['equals', 'gt', 'gte', 'lt', 'lte'],
  select: ['equals', 'in', 'not', 'notIn'],
  relationship: ['equals', 'in'],
}

/**
 * Human-readable labels for operators
 */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: 'contains',
  equals: 'equals',
  startsWith: 'starts with',
  endsWith: 'ends with',
  not: 'not equals',
  gt: 'greater than',
  gte: 'greater than or equal',
  lt: 'less than',
  lte: 'less than or equal',
  in: 'is one of',
  notIn: 'is not one of',
  is: 'is',
}

/**
 * A single filter condition
 */
export interface FilterCondition {
  field: string
  operator: FilterOperator
  value: string | string[] | boolean | number
}

/**
 * Collection of filters for a list
 */
export type ListFilters = FilterCondition[]

/**
 * Filter state stored in URL
 * Format: filters[fieldName][operator]=value
 */
export type FilterURLState = Record<string, Record<FilterOperator, string>>
