import type { AccessControl, Session, AccessContext, PrismaFilter } from './types.js'
import type { FieldAccess } from './types.js'
import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'

/**
 * Runtime type for resolveOutput hooks
 * Used when we need to call hooks generically without knowing the specific field type
 * Supports both sync and async implementations
 */
type ResolveOutputHookRuntime = (args: {
  operation: 'query'
  value: unknown
  item: Record<string, unknown>
  listKey: string
  fieldName: string
  context: AccessContext
}) => unknown | Promise<unknown>

/**
 * Check if access control result is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * Check if access control result is a Prisma filter
 */
export function isPrismaFilter(value: unknown): value is PrismaFilter {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse a relationship ref and get the related list configuration
 * Relationship refs are in the format "ListName.fieldName"
 *
 * @param relationshipRef - The ref string (e.g., "Post.author")
 * @param config - The OpenSaas configuration
 * @returns The related list name and config, or null if not found
 */
export function getRelatedListConfig(
  relationshipRef: string,
  config: OpenSaasConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { listName: string; listConfig: ListConfig<any> } | null {
  // Parse ref format: "ListName.fieldName" or "ListName"
  const parts = relationshipRef.split('.')
  if (parts.length !== 1 && parts.length !== 2) {
    return null
  }

  const listName = parts[0]
  const listConfig = config.lists[listName]

  if (!listConfig) {
    return null
  }

  return { listName, listConfig }
}

/**
 * Execute an access control function
 */
export async function checkAccess<T = Record<string, unknown>>(
  accessControl: AccessControl<T> | undefined,
  args: {
    session: Session | null
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
 * Merge user filter with access control filter
 */
export function mergeFilters(
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
 * Check field-level access for a specific operation
 */
export async function checkFieldAccess(
  fieldAccess: FieldAccess | undefined,
  operation: 'read' | 'create' | 'update',
  args: {
    session: Session | null
    item?: Record<string, unknown>
    context: AccessContext & { _isSudo?: boolean }
    inputData?: Record<string, unknown>
  },
): Promise<boolean> {
  // Skip access check in sudo mode
  if (args.context._isSudo) {
    return true
  }

  if (!fieldAccess) {
    return true // No field access means allow
  }

  const accessControl = fieldAccess[operation]
  if (!accessControl) {
    return true // No specific access control means allow
  }

  const result = await accessControl({
    session: args.session,
    item: args.item,
    context: args.context,
    inputData: args.inputData,
    operation,
  } as Parameters<typeof accessControl>[0])

  // If result is false, deny access
  if (result === false) {
    return false
  }

  // If result is true, allow access
  if (result === true) {
    return true
  }

  // Default to allowing access if we can't determine
  return true
}

/**
 * Simple filter matching for field-level access
 * Checks if an item matches a Prisma-like filter object
 */
function matchesFilter(item: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (typeof condition === 'object' && condition !== null) {
      // Handle nested conditions like { equals: value }
      if ('equals' in condition) {
        if (item[key] !== condition.equals) {
          return false
        }
      } else if ('not' in condition) {
        if (item[key] === condition.not) {
          return false
        }
      }
      // Add more condition types as needed
    } else {
      // Direct equality check
      if (item[key] !== condition) {
        return false
      }
    }
  }
  return true
}

/**
 * Build Prisma include object with access control filters
 * This allows us to filter relationships at the database level instead of in memory
 */
export async function buildIncludeWithAccessControl(
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session | null
    context: AccessContext
  },
  config: OpenSaasConfig,
  depth: number = 0,
) {
  const MAX_DEPTH = 5
  if (depth >= MAX_DEPTH) {
    return undefined
  }

  type IncludeEntry = boolean | { where?: PrismaFilter; include?: Record<string, IncludeEntry> }

  const include: Record<string, IncludeEntry> = {}
  let hasRelationships = false

  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig?.type === 'relationship' && 'ref' in fieldConfig && fieldConfig.ref) {
      hasRelationships = true
      const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)

      if (relatedConfig) {
        // Check query access for the related list
        const queryAccess = relatedConfig.listConfig.access?.operation?.query
        const accessResult = await checkAccess(queryAccess, {
          session: args.session,
          context: args.context,
        })

        // If access is completely denied, exclude this relationship
        if (accessResult === false) {
          continue
        }

        // Build the include entry
        const includeEntry: Record<string, unknown> = {}

        // If access returns a filter, add it to the where clause
        if (typeof accessResult === 'object') {
          includeEntry.where = accessResult
        }

        // Recursively build nested includes
        const nestedInclude = await buildIncludeWithAccessControl(
          relatedConfig.listConfig.fields,
          args,
          config,
          depth + 1,
        )

        if (nestedInclude && Object.keys(nestedInclude).length > 0) {
          includeEntry.include = nestedInclude
        }

        // Add to include object
        include[fieldName] = Object.keys(includeEntry).length > 0 ? includeEntry : true
      }
    }
  }

  return hasRelationships ? include : undefined
}

/**
 * Filter fields from an object based on read access
 * Recursively applies access control to nested relationships
 */
export async function filterReadableFields<T extends Record<string, unknown>>(
  item: T,
  fieldConfigs: Record<string, FieldConfig>,
  args: {
    session: Session | null
    context: AccessContext & { _isSudo?: boolean }
  },
  config?: OpenSaasConfig,
  depth: number = 0,
  listKey?: string,
): Promise<Partial<T>> {
  const filtered: Record<string, unknown> = {}
  const MAX_DEPTH = 5 // Prevent infinite recursion

  // Process existing fields from the database result
  for (const [fieldName, value] of Object.entries(item)) {
    const fieldConfig = fieldConfigs[fieldName]

    // Always include id, createdAt, updatedAt
    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) {
      filtered[fieldName] = value
      continue
    }

    // Check field access (checkFieldAccess already handles sudo mode)
    const canRead = await checkFieldAccess(fieldConfig?.access, 'read', {
      ...args,
      item,
    })

    if (!canRead) {
      continue
    }

    // Handle relationship fields - recursively filter fields within related items
    // Note: Access control filtering is now done at database level via buildIncludeWithAccessControl
    // This only handles field-level access (hiding sensitive fields)
    if (
      config &&
      fieldConfig?.type === 'relationship' &&
      'ref' in fieldConfig &&
      fieldConfig.ref &&
      value !== null &&
      value !== undefined &&
      depth < MAX_DEPTH
    ) {
      const relatedConfig = getRelatedListConfig(fieldConfig.ref as string, config)

      if (relatedConfig) {
        // For many relationships (arrays) - recursively filter fields in each item
        // The recursive call already handles applying resolveOutput hooks
        if (Array.isArray(value)) {
          filtered[fieldName] = await Promise.all(
            value.map((relatedItem) =>
              filterReadableFields(
                relatedItem,
                relatedConfig.listConfig.fields,
                args,
                config,
                depth + 1,
                relatedConfig.listName,
              ),
            ),
          )
        }
        // For single relationships (objects) - recursively filter fields
        // The recursive call already handles applying resolveOutput hooks
        else if (typeof value === 'object') {
          filtered[fieldName] = await filterReadableFields(
            value as Record<string, unknown>,
            relatedConfig.listConfig.fields,
            args,
            config,
            depth + 1,
            relatedConfig.listName,
          )
        }
      } else {
        // Related config not found, include the value as-is
        filtered[fieldName] = value
      }
    } else {
      // Non-relationship field or no config provided - apply resolveOutput hook if present
      if (fieldConfig?.hooks?.resolveOutput && listKey) {
        // Cast to runtime type for generic execution
        // At runtime, the hook will receive the correct value type for the field
        const hook = fieldConfig.hooks.resolveOutput as unknown as ResolveOutputHookRuntime
        // Use Promise.resolve() to handle both sync and async hooks
        filtered[fieldName] = await Promise.resolve(
          hook({
            value,
            operation: 'query',
            fieldName,
            listKey,
            item,
            context: args.context,
          }),
        )
      } else {
        filtered[fieldName] = value
      }
    }
  }

  // Process virtual fields - compute values from other fields
  // Virtual fields don't exist in the database result, so we need to compute them separately
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    // Skip if already processed (from database result)
    if (fieldName in filtered) {
      continue
    }

    // Only process virtual fields
    if (!fieldConfig.virtual) {
      continue
    }

    // Check field access
    const canRead = await checkFieldAccess(fieldConfig.access, 'read', {
      ...args,
      item,
    })

    if (!canRead) {
      continue
    }

    // Virtual fields must have resolveOutput hook to compute their value
    if (fieldConfig.hooks?.resolveOutput && listKey) {
      const hook = fieldConfig.hooks.resolveOutput as unknown as ResolveOutputHookRuntime
      // Use Promise.resolve() to handle both sync and async hooks
      filtered[fieldName] = await Promise.resolve(
        hook({
          value: undefined, // Virtual fields don't have a database value
          operation: 'query',
          fieldName,
          listKey,
          item: filtered, // Pass filtered item so virtual field can access other fields
          context: args.context,
        }),
      )
    }
  }

  return filtered as Partial<T>
}

/**
 * Filter fields from input data based on write access (create/update)
 */
export async function filterWritableFields<T extends Record<string, unknown>>(
  data: T,
  fieldConfigs: Record<string, { access?: FieldAccess; type?: string }>,
  operation: 'create' | 'update',
  args: {
    session: Session | null
    item?: Record<string, unknown>
    context: AccessContext & { _isSudo?: boolean }
    inputData?: Record<string, unknown>
  },
): Promise<Partial<T>> {
  const filtered: Record<string, unknown> = {}

  // Build a set of foreign key field names to exclude
  // Foreign keys should not be in the data when using Prisma's relation syntax
  const foreignKeyFields = new Set<string>()
  for (const [fieldName, fieldConfig] of Object.entries(fieldConfigs)) {
    if (fieldConfig.type === 'relationship') {
      // For non-many relationships, Prisma creates a foreign key field named `${fieldName}Id`
      const relConfig = fieldConfig as { many?: boolean }
      if (!relConfig.many) {
        foreignKeyFields.add(`${fieldName}Id`)
      }
    }
  }

  for (const [fieldName, value] of Object.entries(data)) {
    const fieldConfig = fieldConfigs[fieldName]

    // Skip system fields
    if (['id', 'createdAt', 'updatedAt'].includes(fieldName)) {
      continue
    }

    // Skip virtual fields - they don't store in database
    // Virtual fields with resolveInput hooks handle side effects separately
    if (fieldConfig && 'virtual' in fieldConfig && fieldConfig.virtual) {
      continue
    }

    // Skip foreign key fields (e.g., authorId) when their corresponding relationship field exists
    // This prevents conflicts when using Prisma's relation syntax (e.g., author: { connect: { id } })
    if (foreignKeyFields.has(fieldName)) {
      continue
    }

    // Check field access (checkFieldAccess already handles sudo mode)
    const canWrite = await checkFieldAccess(fieldConfig?.access, operation, {
      ...args,
      inputData: args.inputData,
    })

    if (canWrite) {
      filtered[fieldName] = value
    }
  }

  return filtered as Partial<T>
}
