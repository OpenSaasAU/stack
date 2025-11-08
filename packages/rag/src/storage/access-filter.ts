import type { AccessContext, PrismaFilter, AccessControl } from '@opensaas/stack-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'

/**
 * Execute an access control function (copied from @opensaas/stack-core/access)
 */
async function checkAccess<T = Record<string, unknown>>(
  accessControl: AccessControl<T> | undefined,
  args: {
    session: AccessContext['session']
    item?: T
    context: AccessContext
  },
): Promise<boolean | PrismaFilter<T>> {
  // No access control means deny by default
  if (!accessControl) {
    return false
  }

  // Execute the access control function
  const result = await accessControl(args)

  return result
}

/**
 * Merge user filter with access control filter (copied from @opensaas/stack-core/access)
 */
function mergeFilters(
  userFilter: PrismaFilter | undefined,
  accessFilter: boolean | PrismaFilter,
): PrismaFilter | null {
  // If access is denied, return null
  if (accessFilter === false) {
    return null
  }

  // If access is fully granted, use user filter
  if (accessFilter === true) {
    return userFilter || {}
  }

  // Merge access filter with user filter
  if (!userFilter) {
    return accessFilter
  }

  // Combine filters with AND
  return {
    AND: [accessFilter, userFilter],
  }
}

/**
 * Build access control filter for a given list and context
 * Extracts the filter that would be applied by the access control engine
 *
 * @param listKey - The list name (e.g., 'Post', 'Article')
 * @param context - The access context with session
 * @param config - The OpenSaas configuration
 * @returns Prisma filter object or null if access is denied
 */
export async function buildAccessControlFilter(
  listKey: string,
  context: AccessContext,
  config: OpenSaasConfig,
): Promise<PrismaFilter | null> {
  const listConfig = config.lists[listKey]

  if (!listConfig) {
    throw new Error(`List '${listKey}' not found in config`)
  }

  // Check query access control
  const queryAccess = listConfig.access?.operation?.query

  if (!queryAccess) {
    // No access control means deny by default (following OpenSaaS Stack pattern)
    return null
  }

  // Execute access control function
  const accessResult = await checkAccess(queryAccess, {
    session: context.session,
    context,
  })

  // If access is denied (false), return null
  if (accessResult === false) {
    return null
  }

  // If access is fully granted (true), return empty filter
  if (accessResult === true) {
    return {}
  }

  // Otherwise, return the filter object
  return accessResult
}

/**
 * Merge access control filter with user-provided where clause
 *
 * @param accessFilter - Filter from access control
 * @param userWhere - User-provided where clause
 * @returns Combined filter or null if access is denied
 */
export function mergeAccessFilter(
  accessFilter: PrismaFilter | null,
  userWhere: Record<string, unknown> = {},
): PrismaFilter | null {
  if (accessFilter === null) {
    return null
  }

  return mergeFilters(userWhere, accessFilter)
}

/**
 * Convert a Prisma filter object to SQL WHERE clause
 * Handles common Prisma filter operators
 *
 * @param filter - Prisma filter object
 * @param tableName - Table name for column references
 * @returns SQL WHERE clause string (without "WHERE" keyword)
 */
export function prismaFilterToSQL(filter: PrismaFilter, tableName?: string): string {
  if (!filter || Object.keys(filter).length === 0) {
    return 'TRUE' // No filter means all records
  }

  const conditions: string[] = []

  for (const [key, value] of Object.entries(filter)) {
    // Handle logical operators
    if (key === 'AND') {
      if (!Array.isArray(value)) continue
      const andConditions = value
        .map((subFilter) => prismaFilterToSQL(subFilter, tableName))
        .filter((c) => c !== 'TRUE')
      if (andConditions.length > 0) {
        conditions.push(`(${andConditions.join(' AND ')})`)
      }
      continue
    }

    if (key === 'OR') {
      if (!Array.isArray(value)) continue
      const orConditions = value
        .map((subFilter) => prismaFilterToSQL(subFilter, tableName))
        .filter((c) => c !== 'TRUE')
      if (orConditions.length > 0) {
        conditions.push(`(${orConditions.join(' OR ')})`)
      }
      continue
    }

    if (key === 'NOT') {
      const notCondition = prismaFilterToSQL(value as PrismaFilter, tableName)
      if (notCondition !== 'TRUE') {
        conditions.push(`NOT (${notCondition})`)
      }
      continue
    }

    // Handle field conditions
    const columnName = tableName ? `"${tableName}"."${key}"` : `"${key}"`

    if (value === null) {
      conditions.push(`${columnName} IS NULL`)
      continue
    }

    if (typeof value !== 'object' || value === null) {
      // Direct equality
      const escapedValue = escapeSQLValue(value)
      conditions.push(`${columnName} = ${escapedValue}`)
      continue
    }

    // Handle nested field conditions
    const fieldConditions: string[] = []

    for (const [operator, operatorValue] of Object.entries(value)) {
      switch (operator) {
        case 'equals':
          if (operatorValue === null) {
            fieldConditions.push(`${columnName} IS NULL`)
          } else {
            fieldConditions.push(`${columnName} = ${escapeSQLValue(operatorValue)}`)
          }
          break

        case 'not':
          if (operatorValue === null) {
            fieldConditions.push(`${columnName} IS NOT NULL`)
          } else {
            fieldConditions.push(`${columnName} != ${escapeSQLValue(operatorValue)}`)
          }
          break

        case 'in':
          if (Array.isArray(operatorValue) && operatorValue.length > 0) {
            const values = operatorValue.map((v) => escapeSQLValue(v)).join(', ')
            fieldConditions.push(`${columnName} IN (${values})`)
          }
          break

        case 'notIn':
          if (Array.isArray(operatorValue) && operatorValue.length > 0) {
            const values = operatorValue.map((v) => escapeSQLValue(v)).join(', ')
            fieldConditions.push(`${columnName} NOT IN (${values})`)
          }
          break

        case 'lt':
          fieldConditions.push(`${columnName} < ${escapeSQLValue(operatorValue)}`)
          break

        case 'lte':
          fieldConditions.push(`${columnName} <= ${escapeSQLValue(operatorValue)}`)
          break

        case 'gt':
          fieldConditions.push(`${columnName} > ${escapeSQLValue(operatorValue)}`)
          break

        case 'gte':
          fieldConditions.push(`${columnName} >= ${escapeSQLValue(operatorValue)}`)
          break

        case 'contains':
          fieldConditions.push(`${columnName} LIKE ${escapeSQLValue(`%${operatorValue}%`)}`)
          break

        case 'startsWith':
          fieldConditions.push(`${columnName} LIKE ${escapeSQLValue(`${operatorValue}%`)}`)
          break

        case 'endsWith':
          fieldConditions.push(`${columnName} LIKE ${escapeSQLValue(`%${operatorValue}`)}`)
          break

        case 'isNull':
          if (operatorValue === true) {
            fieldConditions.push(`${columnName} IS NULL`)
          } else {
            fieldConditions.push(`${columnName} IS NOT NULL`)
          }
          break

        // Add more operators as needed
        default:
          console.warn(`Unsupported Prisma filter operator: ${operator}`)
      }
    }

    if (fieldConditions.length > 0) {
      conditions.push(fieldConditions.join(' AND '))
    }
  }

  if (conditions.length === 0) {
    return 'TRUE'
  }

  if (conditions.length === 1) {
    return conditions[0]
  }

  return conditions.join(' AND ')
}

/**
 * Escape SQL values to prevent SQL injection
 * Basic escaping - in production, use parameterized queries
 */
function escapeSQLValue(value: unknown): string {
  if (value === null) {
    return 'NULL'
  }

  if (typeof value === 'string') {
    // Escape single quotes by doubling them
    return `'${value.replace(/'/g, "''")}'`
  }

  if (typeof value === 'number') {
    return value.toString()
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }

  if (value instanceof Date) {
    return `'${value.toISOString()}'`
  }

  // Fallback for other types
  return `'${String(value).replace(/'/g, "''")}'`
}
