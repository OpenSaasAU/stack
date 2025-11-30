/**
 * Filter to SQL conversion utilities
 */
import type { WhereFilter, DatabaseDialect } from '../types/index.js'

export interface SQLCondition {
  sql: string
  params: unknown[]
}

/**
 * Convert filter object to SQL WHERE clause
 */
export function filterToSQL(
  filter: WhereFilter | undefined,
  dialect: DatabaseDialect,
  paramOffset: number = 0,
): SQLCondition {
  if (!filter || Object.keys(filter).length === 0) {
    return { sql: '', params: [] }
  }

  const conditions: string[] = []
  const params: unknown[] = []
  let paramIndex = paramOffset

  for (const [key, value] of Object.entries(filter)) {
    // Handle logical operators
    if (key === 'AND' && Array.isArray(value)) {
      const subConditions = value.map((subFilter) => {
        const result = filterToSQL(subFilter, dialect, paramIndex)
        paramIndex += result.params.length
        params.push(...result.params)
        return result.sql
      })
      if (subConditions.length > 0) {
        conditions.push(`(${subConditions.join(' AND ')})`)
      }
      continue
    }

    if (key === 'OR' && Array.isArray(value)) {
      const subConditions = value.map((subFilter) => {
        const result = filterToSQL(subFilter, dialect, paramIndex)
        paramIndex += result.params.length
        params.push(...result.params)
        return result.sql
      })
      if (subConditions.length > 0) {
        conditions.push(`(${subConditions.join(' OR ')})`)
      }
      continue
    }

    if (key === 'NOT') {
      const result = filterToSQL(value as WhereFilter, dialect, paramIndex)
      paramIndex += result.params.length
      params.push(...result.params)
      if (result.sql) {
        conditions.push(`NOT (${result.sql})`)
      }
      continue
    }

    // Handle field operators
    const columnName = dialect.quoteIdentifier(key)

    // Check if value is an operator object
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const operator = value as Record<string, unknown>

      if ('equals' in operator) {
        if (operator.equals === null) {
          conditions.push(`${columnName} IS NULL`)
        } else {
          conditions.push(`${columnName} = ${dialect.getPlaceholder(paramIndex)}`)
          params.push(operator.equals)
          paramIndex++
        }
      } else if ('not' in operator) {
        if (operator.not === null) {
          conditions.push(`${columnName} IS NOT NULL`)
        } else {
          conditions.push(`${columnName} != ${dialect.getPlaceholder(paramIndex)}`)
          params.push(operator.not)
          paramIndex++
        }
      } else if ('in' in operator && Array.isArray(operator.in)) {
        const placeholders = operator.in.map(() => dialect.getPlaceholder(paramIndex++))
        conditions.push(`${columnName} IN (${placeholders.join(', ')})`)
        params.push(...operator.in)
      } else if ('notIn' in operator && Array.isArray(operator.notIn)) {
        const placeholders = operator.notIn.map(() => dialect.getPlaceholder(paramIndex++))
        conditions.push(`${columnName} NOT IN (${placeholders.join(', ')})`)
        params.push(...operator.notIn)
      } else if ('lt' in operator) {
        conditions.push(`${columnName} < ${dialect.getPlaceholder(paramIndex)}`)
        params.push(operator.lt)
        paramIndex++
      } else if ('lte' in operator) {
        conditions.push(`${columnName} <= ${dialect.getPlaceholder(paramIndex)}`)
        params.push(operator.lte)
        paramIndex++
      } else if ('gt' in operator) {
        conditions.push(`${columnName} > ${dialect.getPlaceholder(paramIndex)}`)
        params.push(operator.gt)
        paramIndex++
      } else if ('gte' in operator) {
        conditions.push(`${columnName} >= ${dialect.getPlaceholder(paramIndex)}`)
        params.push(operator.gte)
        paramIndex++
      } else if ('contains' in operator) {
        conditions.push(`${columnName} LIKE ${dialect.getPlaceholder(paramIndex)}`)
        params.push(`%${operator.contains}%`)
        paramIndex++
      } else if ('startsWith' in operator) {
        conditions.push(`${columnName} LIKE ${dialect.getPlaceholder(paramIndex)}`)
        params.push(`${operator.startsWith}%`)
        paramIndex++
      } else if ('endsWith' in operator) {
        conditions.push(`${columnName} LIKE ${dialect.getPlaceholder(paramIndex)}`)
        params.push(`%${operator.endsWith}`)
        paramIndex++
      }
    } else {
      // Direct value comparison
      if (value === null) {
        conditions.push(`${columnName} IS NULL`)
      } else {
        conditions.push(`${columnName} = ${dialect.getPlaceholder(paramIndex)}`)
        params.push(value)
        paramIndex++
      }
    }
  }

  const sql = conditions.length > 0 ? conditions.join(' AND ') : ''
  return { sql, params }
}

/**
 * Merge two filters with AND logic
 * This is used for access control filter merging
 */
export function mergeFilters(
  filter1: WhereFilter | undefined,
  filter2: WhereFilter | undefined,
): WhereFilter | undefined {
  if (!filter1 && !filter2) return undefined
  if (!filter1) return filter2
  if (!filter2) return filter1

  // Merge with AND
  return { AND: [filter1, filter2] }
}
