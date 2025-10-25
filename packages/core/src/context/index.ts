import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import type { Session, AccessContext, AccessControlledDB } from '../access/index.js'
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
} from '../hooks/index.js'
import { processNestedOperations } from './nested-operations.js'
import { getDbKey } from '../lib/case-utils.js'
import type { PrismaClientLike } from '../access/types.js'
import type { FieldConfig } from '../config/types.js'

/**
 * Execute field-level beforeOperation hooks
 * Allows fields to transform their values before database write
 */
async function executeFieldBeforeOperationHooks(
  data: Record<string, unknown>,
  fields: Record<string, FieldConfig>,
  operation: 'create' | 'update',
  context: AccessContext,
  listName: string,
  item?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = { ...data }

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip if field not in data
    if (!(fieldName in result)) continue

    // Skip if no hooks defined
    if (!fieldConfig.hooks?.beforeOperation) continue

    // Execute field hook
    const transformedValue = await fieldConfig.hooks.beforeOperation({
      value: result[fieldName],
      operation,
      fieldName,
      listName,
      item,
      context,
    })

    result[fieldName] = transformedValue
  }

  return result
}

/**
 * Execute field-level afterOperation hooks
 * Allows fields to transform their values after database read
 */
function executeFieldAfterOperationHooks(
  item: Record<string, unknown> | null,
  fields: Record<string, FieldConfig>,
  context: AccessContext,
  listName: string,
): Record<string, unknown> | null {
  if (!item) return null

  const result = { ...item }

  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    // Skip if field not in result
    if (!(fieldName in result)) continue

    // Skip if no hooks defined
    if (!fieldConfig.hooks?.afterOperation) continue

    // Execute field hook
    const transformedValue = fieldConfig.hooks.afterOperation({
      value: result[fieldName],
      operation: 'read',
      fieldName,
      listName,
      item,
      context,
    })

    result[fieldName] = transformedValue
  }

  return result
}
export type ServerActionProps =
  | { listKey: string; action: 'create'; data: Record<string, unknown> }
  | { listKey: string; action: 'update'; id: string; data: Record<string, unknown> }
  | { listKey: string; action: 'delete'; id: string }
/**
 * Create an access-controlled context
 *
 * @param config - OpenSaas configuration
 * @param prisma - Your Prisma client instance (pass as generic for type safety)
 * @param session - Current session object (or null if not authenticated)
 */
export function getContext<
  TConfig extends OpenSaasConfig,
  TPrisma extends PrismaClientLike = PrismaClientLike,
>(
  config: TConfig,
  prisma: TPrisma,
  session: Session,
): {
  db: AccessControlledDB<TPrisma>
  session: Session
  prisma: TPrisma
  serverAction: (props: ServerActionProps) => Promise<unknown>
} {
  // Initialize db object - will be populated with access-controlled operations
  // Type is intentionally broad to allow dynamic model access
  const db: Record<string, unknown> = {}

  // Create context with db reference (will be populated below)
  const context: AccessContext<TPrisma> = {
    session,
    prisma: prisma as TPrisma,
    db: db as AccessControlledDB<TPrisma>,
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

  // Generic server action handler with discriminated union for type safety
  async function serverAction(props: ServerActionProps): Promise<unknown> {
    const dbKey = getDbKey(props.listKey)
    const model = db[dbKey] as {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
      delete: (args: { where: { id: string } }) => Promise<unknown>
    }

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
  }

  return {
    db: db as AccessControlledDB<TPrisma>,
    session,
    prisma,
    serverAction,
  }
}

/**
 * Create findUnique operation with access control
 */
function createFindUnique<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  return async (args: { where: { id: string }; include?: Record<string, unknown> }) => {
    // Check query access
    const queryAccess = listConfig.access?.operation?.query
    const accessResult = await checkAccess(queryAccess, {
      session: context.session,
      context,
    })

    if (accessResult === false) {
      return null
    }

    // Merge access filter with where clause
    const where = mergeFilters(args.where, accessResult)
    if (where === null) {
      return null
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

    // Filter readable fields (now only handles field-level access, not array filtering)
    const filtered = await filterReadableFields(
      item,
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
    )

    // Execute field afterOperation hooks (e.g., wrap password with HashedPassword)
    return executeFieldAfterOperationHooks(filtered, listConfig.fields, context, listName)
  }
}

/**
 * Create findMany operation with access control
 */
function createFindMany<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  return async (args?: {
    where?: Record<string, unknown>
    take?: number
    skip?: number
    include?: Record<string, unknown>
  }) => {
    // Check query access
    const queryAccess = listConfig.access?.operation?.query
    const accessResult = await checkAccess(queryAccess, {
      session: context.session,
      context,
    })

    if (accessResult === false) {
      return []
    }

    // Merge access filter with where clause
    const where = mergeFilters(args?.where, accessResult)
    if (where === null) {
      return []
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

    // Filter readable fields for each item (now only handles field-level access)
    const filtered = await Promise.all(
      items.map((item: Record<string, unknown>) =>
        filterReadableFields(
          item,
          listConfig.fields,
          {
            session: context.session,
            context,
          },
          config,
        ),
      ),
    )

    // Execute field afterOperation hooks for each item
    return filtered.map((item) =>
      executeFieldAfterOperationHooks(item, listConfig.fields, context, listName),
    )
  }
}

/**
 * Create create operation with access control and hooks
 */
function createCreate<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext,
  config: OpenSaasConfig,
) {
  return async (args: { data: Record<string, unknown> }) => {
    // 1. Check create access
    const createAccess = listConfig.access?.operation?.create
    const accessResult = await checkAccess(createAccess, {
      session: context.session,
      context,
    })

    if (accessResult === false) {
      return null
    }

    // 2. Execute resolveInput hook
    let resolvedData = await executeResolveInput(listConfig.hooks, {
      operation: 'create',
      resolvedData: args.data,
      context,
    })

    // 2.5. Execute field beforeOperation hooks (e.g., hash passwords)
    resolvedData = await executeFieldBeforeOperationHooks(
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

    // 5. Filter writable fields (field-level access control)
    const filteredData = await filterWritableFields(resolvedData, listConfig.fields, 'create', {
      session: context.session,
      context,
    })

    // 5.5. Process nested relationship operations
    const data = await processNestedOperations(
      filteredData,
      listConfig.fields,
      config,
      { ...context, prisma },
      'create',
    )

    // 6. Execute beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: 'create',
      context,
    })

    // 7. Execute database create
    // Access Prisma model dynamically - required because model names are generated at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const item = await model.create({
      data,
    })

    // 8. Execute afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: 'create',
      item,
      context,
    })

    // 9. Filter readable fields
    const filtered = await filterReadableFields(
      item,
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
    )

    // Execute field afterOperation hooks (e.g., wrap password with HashedPassword)
    return executeFieldAfterOperationHooks(filtered, listConfig.fields, context, listName)
  }
}

/**
 * Create update operation with access control and hooks
 */
function createUpdate<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext,
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

    // 2. Check update access
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

    // 3. Execute resolveInput hook
    let resolvedData = await executeResolveInput(listConfig.hooks, {
      operation: 'update',
      resolvedData: args.data,
      item,
      context,
    })

    // 3.5. Execute field beforeOperation hooks (e.g., hash passwords)
    resolvedData = await executeFieldBeforeOperationHooks(
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

    // 6. Filter writable fields (field-level access control)
    const filteredData = await filterWritableFields(resolvedData, listConfig.fields, 'update', {
      session: context.session,
      item,
      context,
    })

    // 6.5. Process nested relationship operations
    const data = await processNestedOperations(
      filteredData,
      listConfig.fields,
      config,
      { ...context, prisma },
      'update',
    )

    // 7. Execute beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: 'update',
      item,
      context,
    })

    // 8. Execute database update
    const updated = await model.update({
      where: args.where,
      data,
    })

    // 9. Execute afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: 'update',
      item: updated,
      context,
    })

    // 10. Filter readable fields
    const filtered = await filterReadableFields(
      updated,
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
    )

    // Execute field afterOperation hooks (e.g., wrap password with HashedPassword)
    return executeFieldAfterOperationHooks(filtered, listConfig.fields, context, listName)
  }
}

/**
 * Create delete operation with access control and hooks
 */
function createDelete<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext,
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

    // 2. Check delete access
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

    // 3. Execute beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: 'delete',
      item,
      context,
    })

    // 4. Execute database delete
    const deleted = await model.delete({
      where: args.where,
    })

    // 5. Execute afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: 'delete',
      item: deleted,
      context,
    })

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
  context: AccessContext,
) {
  return async (args?: { where?: Record<string, unknown> }) => {
    // Check query access
    const queryAccess = listConfig.access?.operation?.query
    const accessResult = await checkAccess(queryAccess, {
      session: context.session,
      context,
    })

    if (accessResult === false) {
      return 0
    }

    // Merge access filter with where clause
    const where = mergeFilters(args?.where, accessResult)
    if (where === null) {
      return 0
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
