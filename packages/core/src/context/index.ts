import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import type { Session, AccessContext, AccessControlledDB, StorageUtils } from '../access/index.js'
import {
  checkAccess,
  mergeFilters,
  filterReadableFields,
  filterWritableFields,
  buildIncludeWithAccessControl,
} from '../access/index.js'
import {
  executeResolveInput,
  executeValidateInput,
  executeBeforeOperation,
  executeAfterOperation,
  validateFieldRules,
  ValidationError,
  DatabaseError,
} from '../hooks/index.js'
import { processNestedOperations } from './nested-operations.js'
import { getDbKey } from '../lib/case-utils.js'
import type { PrismaClientLike } from '../access/types.js'
import type { FieldConfig } from '../config/types.js'

/**
 * Execute field-level resolveInput hooks
 * Allows fields to transform their input values before database write
 */
async function executeFieldResolveInputHooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update',
  context: AccessContext,
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item?: any,
): Promise<Record<string, unknown>> {
  const result = { ...data }

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip if field not in data
    if (!(fieldName in result)) continue

    // Skip if no hooks defined
    if (!fieldConfig.hooks?.resolveInput) continue

    // Execute field hook
    // Type assertion is safe here because hooks are typed correctly in field definitions
    // and we're working with runtime values that match those types

    const transformedValue = await fieldConfig.hooks.resolveInput({
      inputValue: result[fieldName],
      operation,
      fieldName,
      listKey,
      item,
      context,
    })

    result[fieldName] = transformedValue
  }

  return result
}

/**
 * Execute field-level beforeOperation hooks (side effects only)
 * Allows fields to perform side effects before database write
 */
async function executeFieldBeforeOperationHooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update' | 'delete',
  context: AccessContext,
  listKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item?: any,
): Promise<void> {
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip if field not in data (for create/update) or if no hooks defined
    if (!fieldConfig.hooks?.beforeOperation) continue
    if (operation !== 'delete' && !(fieldName in data)) continue

    // Execute field hook (side effects only, no return value used)
    // Type assertion is safe here because hooks are typed correctly in field definitions
    await fieldConfig.hooks.beforeOperation({
      resolvedValue: data[fieldName],
      operation,
      fieldName,
      listKey,
      item,
      context,
    })
  }
}

/**
 * Execute field-level afterOperation hooks (side effects only)
 * Allows fields to perform side effects after database operations
 */
async function executeFieldAfterOperationHooks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  data: Record<string, unknown> | undefined,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update' | 'delete' | 'query',
  context: AccessContext,
  listKey: string,
): Promise<void> {
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip if no hooks defined
    if (!fieldConfig.hooks?.afterOperation) continue

    // Get the value from item (for all operations)
    const value = item?.[fieldName]

    // Execute field hook (side effects only, no return value used)
    await fieldConfig.hooks.afterOperation({
      value,
      operation,
      fieldName,
      listKey,
      item,
      context,
    })
  }
}

export type ServerActionProps =
  | { listKey: string; action: 'create'; data: Record<string, unknown> }
  | { listKey: string; action: 'update'; id: string; data: Record<string, unknown> }
  | { listKey: string; action: 'delete'; id: string }

/**
 * Parse Prisma error and convert to user-friendly DatabaseError
 */
function parsePrismaError(error: unknown, listConfig: ListConfig): Error {
  // Check if it's a Prisma error
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'meta' in error &&
    typeof error.code === 'string'
  ) {
    const prismaError = error as { code: string; meta?: { target?: string[] }; message?: string }

    // Handle unique constraint violation
    if (prismaError.code === 'P2002') {
      const target = prismaError.meta?.target
      const fieldErrors: Record<string, string> = {}

      if (target && Array.isArray(target)) {
        // Get field names from the constraint target
        for (const fieldName of target) {
          // Get the field config to get a better label
          const fieldConfig = listConfig.fields[fieldName]
          const label = fieldName.charAt(0).toUpperCase() + fieldName.slice(1)

          if (fieldConfig) {
            fieldErrors[fieldName] = `This ${label.toLowerCase()} is already in use`
          } else {
            fieldErrors[fieldName] = `This value is already in use`
          }
        }

        // Create a user-friendly general message
        const fieldLabels = target.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(', ')
        return new DatabaseError(
          `${fieldLabels} must be unique. The value you entered is already in use.`,
          fieldErrors,
          prismaError.code,
        )
      }

      return new DatabaseError('A record with this value already exists', {}, prismaError.code)
    }

    // Handle other Prisma errors - return generic message
    return new DatabaseError(
      prismaError.message || 'A database error occurred',
      {},
      prismaError.code,
    )
  }

  // Not a Prisma error, return as-is if it's already an Error
  if (error instanceof Error) {
    return error
  }

  // Unknown error type
  return new Error('An unknown error occurred')
}

/**
 * Create an access-controlled context
 *
 * @param config - OpenSaas configuration
 * @param prisma - Your Prisma client instance (pass as generic for type safety)
 * @param session - Current session object (or null if not authenticated)
 * @param storage - Optional storage utilities (uploadFile, uploadImage, deleteFile, deleteImage)
 */
export function getContext<
  TConfig extends OpenSaasConfig,
  TPrisma extends PrismaClientLike = PrismaClientLike,
>(
  config: TConfig,
  prisma: TPrisma,
  session: Session | null,
  storage?: StorageUtils,
  _isSudo: boolean = false,
): {
  db: AccessControlledDB<TPrisma>
  session: Session | null
  prisma: TPrisma
  storage: StorageUtils
  plugins: Record<string, unknown>
  serverAction: (props: ServerActionProps) => Promise<unknown>
  _isSudo: boolean
  sudo: () => {
    db: AccessControlledDB<TPrisma>
    session: Session | null
    prisma: TPrisma
    storage: StorageUtils
    plugins: Record<string, unknown>
    serverAction: (props: ServerActionProps) => Promise<unknown>
    sudo: () => unknown
    _isSudo: boolean
  }
} {
  // Initialize db object - will be populated with access-controlled operations
  // Type is intentionally broad to allow dynamic model access
  const db: Record<string, unknown> = {}

  // Create context with db reference (will be populated below)
  // Storage utilities can be provided via parameter or use default stubs
  const context: AccessContext<TPrisma> = {
    session,
    prisma: prisma as TPrisma,
    db: db as AccessControlledDB<TPrisma>,
    storage: storage ?? {
      uploadFile: async () => {
        throw new Error(
          'No storage providers configured. Add storage providers to your opensaas.config.ts',
        )
      },
      uploadImage: async () => {
        throw new Error(
          'No storage providers configured. Add storage providers to your opensaas.config.ts',
        )
      },
      deleteFile: async () => {
        throw new Error(
          'No storage providers configured. Add storage providers to your opensaas.config.ts',
        )
      },
      deleteImage: async () => {
        throw new Error(
          'No storage providers configured. Add storage providers to your opensaas.config.ts',
        )
      },
    },
    plugins: {}, // Will be populated with plugin runtime services
    _isSudo,
  }

  // Create access-controlled operations for each list
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    const dbKey = getDbKey(listName)

    db[dbKey] = {
      findUnique: createFindUnique(listName, listConfig, prisma, context, config),
      findMany: createFindMany(listName, listConfig, prisma, context, config),
      create: createCreate(listName, listConfig, prisma, context, config),
      update: createUpdate(listName, listConfig, prisma, context, config),
      delete: createDelete(listName, listConfig, prisma, context),
      count: createCount(listName, listConfig, prisma, context),
    }
  }

  // Execute plugin runtime functions and populate context.plugins
  // Use _plugins (sorted by dependencies) if available, otherwise fall back to plugins array
  const pluginsToExecute = config._plugins || config.plugins || []
  for (const plugin of pluginsToExecute) {
    if (plugin.runtime) {
      try {
        context.plugins[plugin.name] = plugin.runtime(context)
      } catch (error) {
        console.error(`Error executing runtime for plugin "${plugin.name}":`, error)
        // Continue with other plugins even if one fails
      }
    }
  }

  // Generic server action handler with discriminated union for type safety
  async function serverAction(props: ServerActionProps): Promise<unknown> {
    const dbKey = getDbKey(props.listKey)
    const listConfig = config.lists[props.listKey]

    if (!listConfig) {
      throw new Error(`List "${props.listKey}" not found in configuration`)
    }

    const model = db[dbKey] as {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
      delete: (args: { where: { id: string } }) => Promise<unknown>
    }

    try {
      if (props.action === 'create') {
        return await model.create({ data: props.data })
      } else if (props.action === 'update') {
        return await model.update({
          where: { id: props.id },
          data: props.data,
        })
      } else if (props.action === 'delete') {
        return await model.delete({
          where: { id: props.id },
        })
      }

      return null
    } catch (error) {
      // Re-throw ValidationError as-is (it already has fieldErrors)
      if (error instanceof ValidationError) {
        throw error
      }

      // Parse and convert Prisma errors to user-friendly DatabaseError
      throw parsePrismaError(error, listConfig)
    }
  }

  // Sudo function - creates a new context that bypasses access control
  // but still executes all hooks and validation
  function sudo() {
    return getContext(config, prisma, session, context.storage, true)
  }

  return {
    db: db as AccessControlledDB<TPrisma>,
    session,
    prisma,
    storage: context.storage,
    plugins: context.plugins,
    serverAction,
    sudo,
    _isSudo,
  }
}

/**
 * Create findUnique operation with access control
 */
function createFindUnique<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
  config: OpenSaasConfig,
) {
  return async (args: { where: { id: string }; include?: Record<string, unknown> }) => {
    // Check query access (skip if sudo mode)
    let where: Record<string, unknown> = args.where
    if (!context._isSudo) {
      const queryAccess = listConfig.access?.operation?.query
      const accessResult = await checkAccess(queryAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        return null
      }

      // Merge access filter with where clause
      const mergedWhere = mergeFilters(args.where, accessResult)
      if (mergedWhere === null) {
        return null
      }
      where = mergedWhere
    }

    // Build include with access control filters
    const accessControlledInclude = await buildIncludeWithAccessControl(
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
    )

    // Merge user-provided include with access-controlled include
    const include = args.include || accessControlledInclude

    // Execute query with optimized includes
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const item = await model.findFirst({
      where,
      include,
    })

    if (!item) {
      return null
    }

    // Filter readable fields and apply resolveOutput hooks (including nested relationships)
    // Pass sudo flag through context to skip field-level access checks
    const filtered = await filterReadableFields(
      item,
      listConfig.fields,
      {
        session: context.session,
        context: { ...context, _isSudo: context._isSudo },
      },
      config,
      0,
      listName,
    )

    // Execute field afterOperation hooks (side effects only)
    await executeFieldAfterOperationHooks(
      filtered,
      undefined,
      listConfig.fields,
      'query',
      context,
      listName,
    )

    return filtered
  }
}

/**
 * Create findMany operation with access control
 */
function createFindMany<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
  config: OpenSaasConfig,
) {
  return async (args?: {
    where?: Record<string, unknown>
    take?: number
    skip?: number
    include?: Record<string, unknown>
  }) => {
    // Check query access (skip if sudo mode)
    let where: Record<string, unknown> | undefined = args?.where
    if (!context._isSudo) {
      const queryAccess = listConfig.access?.operation?.query
      const accessResult = await checkAccess(queryAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        return []
      }

      // Merge access filter with where clause
      const mergedWhere = mergeFilters(args?.where, accessResult)
      if (mergedWhere === null) {
        return []
      }
      where = mergedWhere
    }

    // Build include with access control filters
    const accessControlledInclude = await buildIncludeWithAccessControl(
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
    )

    // Merge user-provided include with access-controlled include
    const include = args?.include || accessControlledInclude

    // Execute query with optimized includes
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const items = await model.findMany({
      where,
      take: args?.take,
      skip: args?.skip,
      include,
    })

    // Filter readable fields for each item and apply resolveOutput hooks (including nested relationships)
    // Pass sudo flag through context to skip field-level access checks
    const filtered = await Promise.all(
      items.map((item: Record<string, unknown>) =>
        filterReadableFields(
          item,
          listConfig.fields,
          {
            session: context.session,
            context: { ...context, _isSudo: context._isSudo },
          },
          config,
          0,
          listName,
        ),
      ),
    )

    // Execute field afterOperation hooks for each item (side effects only)
    await Promise.all(
      filtered.map((item) =>
        executeFieldAfterOperationHooks(
          item,
          undefined,
          listConfig.fields,
          'query',
          context,
          listName,
        ),
      ),
    )

    return filtered
  }
}

/**
 * Create create operation with access control and hooks
 */
function createCreate<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
  config: OpenSaasConfig,
) {
  return async (args: { data: Record<string, unknown> }) => {
    // 1. Check create access (skip if sudo mode)
    if (!context._isSudo) {
      const createAccess = listConfig.access?.operation?.create
      const accessResult = await checkAccess(createAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        return null
      }
    }

    // 2. Execute list-level resolveInput hook
    let resolvedData = await executeResolveInput(listConfig.hooks, {
      operation: 'create',
      resolvedData: args.data,
      context,
    })

    // 2.5. Execute field-level resolveInput hooks (e.g., hash passwords)
    resolvedData = await executeFieldResolveInputHooks(
      resolvedData,
      listConfig.fields,
      'create',
      context,
      listName,
    )

    // 3. Execute validateInput hook
    await executeValidateInput(listConfig.hooks, {
      operation: 'create',
      resolvedData,
      context,
    })

    // 4. Field validation (isRequired, length, etc.)
    const validation = validateFieldRules(resolvedData, listConfig.fields, 'create')
    if (validation.errors.length > 0) {
      throw new ValidationError(validation.errors, validation.fieldErrors)
    }

    // 5. Filter writable fields (field-level access control, skip if sudo mode)
    const filteredData = await filterWritableFields(resolvedData, listConfig.fields, 'create', {
      session: context.session,
      context: { ...context, _isSudo: context._isSudo },
    })

    // 5.5. Process nested relationship operations
    const data = await processNestedOperations(
      filteredData,
      listConfig.fields,
      config,
      { ...context, prisma },
      'create',
    )

    // 6. Execute field-level beforeOperation hooks (side effects only)
    await executeFieldBeforeOperationHooks(data, listConfig.fields, 'create', context, listName)

    // 7. Execute list-level beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: 'create',
      context,
    })

    // 8. Execute database create
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const item = await model.create({
      data,
    })

    // 9. Execute list-level afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: 'create',
      item,
      context,
    })

    // 10. Execute field-level afterOperation hooks (side effects only)
    await executeFieldAfterOperationHooks(
      item,
      data,
      listConfig.fields,
      'create',
      context,
      listName,
    )

    // 11. Filter readable fields and apply resolveOutput hooks (including nested relationships)
    // Pass sudo flag through context to skip field-level access checks
    const filtered = await filterReadableFields(
      item,
      listConfig.fields,
      {
        session: context.session,
        context: { ...context, _isSudo: context._isSudo },
      },
      config,
      0,
      listName,
    )

    return filtered
  }
}

/**
 * Create update operation with access control and hooks
 */
function createUpdate<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
  config: OpenSaasConfig,
) {
  return async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    // 1. Fetch the item to pass to access control and hooks
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const item = await model.findUnique({
      where: args.where,
    })

    if (!item) {
      return null
    }

    // 2. Check update access (skip if sudo mode)
    if (!context._isSudo) {
      const updateAccess = listConfig.access?.operation?.update
      const accessResult = await checkAccess(updateAccess, {
        session: context.session,
        item,
        context,
      })

      if (accessResult === false) {
        return null
      }

      // If access returns a filter, check if item matches
      if (typeof accessResult === 'object') {
        const matchesFilter = await model.findFirst({
          where: mergeFilters(args.where, accessResult),
        })

        if (!matchesFilter) {
          return null
        }
      }
    }

    // 3. Execute list-level resolveInput hook
    let resolvedData = await executeResolveInput(listConfig.hooks, {
      operation: 'update',
      resolvedData: args.data,
      item,
      context,
    })

    // 3.5. Execute field-level resolveInput hooks (e.g., hash passwords)
    resolvedData = await executeFieldResolveInputHooks(
      resolvedData,
      listConfig.fields,
      'update',
      context,
      listName,
      item,
    )

    // 4. Execute validateInput hook
    await executeValidateInput(listConfig.hooks, {
      operation: 'update',
      resolvedData,
      item,
      context,
    })

    // 5. Field validation (isRequired, length, etc.)
    const validation = validateFieldRules(resolvedData, listConfig.fields, 'update')
    if (validation.errors.length > 0) {
      throw new ValidationError(validation.errors, validation.fieldErrors)
    }

    // 6. Filter writable fields (field-level access control, skip if sudo mode)
    const filteredData = await filterWritableFields(resolvedData, listConfig.fields, 'update', {
      session: context.session,
      item,
      context: { ...context, _isSudo: context._isSudo },
    })

    // 6.5. Process nested relationship operations
    const data = await processNestedOperations(
      filteredData,
      listConfig.fields,
      config,
      { ...context, prisma },
      'update',
    )

    // 7. Execute field-level beforeOperation hooks (side effects only)
    await executeFieldBeforeOperationHooks(
      data,
      listConfig.fields,
      'update',
      context,
      listName,
      item,
    )

    // 8. Execute list-level beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: 'update',
      item,
      context,
    })

    // 9. Execute database update
    const updated = await model.update({
      where: args.where,
      data,
    })

    // 10. Execute list-level afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: 'update',
      item: updated,
      context,
    })

    // 11. Execute field-level afterOperation hooks (side effects only)
    await executeFieldAfterOperationHooks(
      updated,
      data,
      listConfig.fields,
      'update',
      context,
      listName,
    )

    // 12. Filter readable fields and apply resolveOutput hooks (including nested relationships)
    // Pass sudo flag through context to skip field-level access checks
    const filtered = await filterReadableFields(
      updated,
      listConfig.fields,
      {
        session: context.session,
        context: { ...context, _isSudo: context._isSudo },
      },
      config,
      0,
      listName,
    )

    return filtered
  }
}

/**
 * Create delete operation with access control and hooks
 */
function createDelete<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
) {
  return async (args: { where: { id: string } }) => {
    // 1. Fetch the item to pass to access control and hooks
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const item = await model.findUnique({
      where: args.where,
    })

    if (!item) {
      return null
    }

    // 2. Check delete access (skip if sudo mode)
    if (!context._isSudo) {
      const deleteAccess = listConfig.access?.operation?.delete
      const accessResult = await checkAccess(deleteAccess, {
        session: context.session,
        item,
        context,
      })

      if (accessResult === false) {
        return null
      }

      // If access returns a filter, check if item matches
      if (typeof accessResult === 'object') {
        const matchesFilter = await model.findFirst({
          where: mergeFilters(args.where, accessResult),
        })

        if (!matchesFilter) {
          return null
        }
      }
    }

    // 3. Execute field-level beforeOperation hooks (side effects only)
    await executeFieldBeforeOperationHooks({}, listConfig.fields, 'delete', context, listName, item)

    // 4. Execute list-level beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: 'delete',
      item,
      context,
    })

    // 5. Execute database delete
    const deleted = await model.delete({
      where: args.where,
    })

    // 6. Execute list-level afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: 'delete',
      item: deleted,
      context,
    })

    // 7. Execute field-level afterOperation hooks (side effects only)
    await executeFieldAfterOperationHooks(
      deleted,
      undefined,
      listConfig.fields,
      'delete',
      context,
      listName,
    )

    return deleted
  }
}

/**
 * Create count operation with access control
 */
function createCount<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext<TPrisma>,
) {
  return async (args?: { where?: Record<string, unknown> }) => {
    // Check query access (skip if sudo mode)
    let where: Record<string, unknown> | undefined = args?.where
    if (!context._isSudo) {
      const queryAccess = listConfig.access?.operation?.query
      const accessResult = await checkAccess(queryAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        return 0
      }

      // Merge access filter with where clause
      const mergedWhere = mergeFilters(args?.where, accessResult)
      if (mergedWhere === null) {
        return 0
      }
      where = mergedWhere
    }

    // Execute count
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const count = await model.count({
      where,
    })

    return count
  }
}
