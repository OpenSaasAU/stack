import { checkAccess, mergeFilters } from '@opensaas/stack-core'
import type { AccessContext, PrismaFilter } from '@opensaas/stack-core'
import type { OpenSaasConfig } from '@opensaas/stack-core'

export async function buildAccessControlFilter(
  listKey: string,
  context: AccessContext,
  config: OpenSaasConfig,
): Promise<PrismaFilter | null> {
  const listConfig = config.lists[listKey]

  if (!listConfig) {
    throw new Error(`List '${listKey}' not found in config`)
  }

  const queryAccess = listConfig.access?.operation?.query

  if (!queryAccess) {
    return null
  }

  const accessResult = await checkAccess(queryAccess, {
    session: context.session,
    context,
  })

  if (accessResult === false) {
    return null
  }

  if (accessResult === true) {
    return {}
  }

  return accessResult
}

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
 * Converts a Prisma filter to a SQL WHERE fragment (no "WHERE" keyword), for
 * $queryRawUnsafe call sites that must apply an access-control filter outside
 * Prisma's query builder. An operator with no case below is dropped rather than
 * thrown (see the `default` case), which WIDENS the WHERE clause instead of
 * narrowing it — an access filter using an unhandled operator would under-filter.
 */
export function prismaFilterToSQL(filter: PrismaFilter, tableName?: string): string {
  if (!filter || Object.keys(filter).length === 0) {
    return 'TRUE'
  }

  const conditions: string[] = []

  for (const [key, value] of Object.entries(filter)) {
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

    const columnName = tableName ? `"${tableName}"."${key}"` : `"${key}"`

    if (value === null) {
      conditions.push(`${columnName} IS NULL`)
      continue
    }

    if (typeof value !== 'object' || value === null) {
      const escapedValue = escapeSQLValue(value)
      conditions.push(`${columnName} = ${escapedValue}`)
      continue
    }

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
 * Basic escaping only — not a substitute for parameterized queries in production.
 */
function escapeSQLValue(value: unknown): string {
  if (value === null) {
    return 'NULL'
  }

  if (typeof value === 'string') {
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

  return `'${String(value).replace(/'/g, "''")}'`
}
