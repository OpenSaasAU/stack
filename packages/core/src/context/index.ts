import type { OpenSaaSConfig, ListConfig } from '../config/types.js'
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

/**
 * Create an access-controlled context
 *
 * @param config - OpenSaaS configuration
 * @param prisma - Your Prisma client instance (pass as generic for type safety)
 * @param session - Current session object (or null if not authenticated)
 */
export async function getContext<TPrisma extends PrismaClientLike = PrismaClientLike>(
  config: OpenSaaSConfig,
  prisma: TPrisma,
  session: Session,
): Promise<{
  db: AccessControlledDB<TPrisma>
  session: Session
  prisma: TPrisma
  serverAction: (props: {
    listKey: string
    action: 'create' | 'update' | 'delete'
    data?: Record<string, unknown>
    id?: string
  }) => Promise<unknown>
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {}

  // Create context with db reference (will be populated below)
  const context: AccessContext = {
    session,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: prisma as any,
    db,
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

  // Generic server action handler
  async function serverAction(props: {
    listKey: string
    action: 'create' | 'update' | 'delete'
    data?: Record<string, unknown>
    id?: string
  }) {
    const dbKey = getDbKey(props.listKey)

    if (props.action === 'create') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (db[dbKey] as any).create({ data: props.data })
    } else if (props.action === 'update') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (db[dbKey] as any).update({
        where: { id: props.id },
        data: props.data,
      })
    } else if (props.action === 'delete') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (db[dbKey] as any).delete({
        where: { id: props.id },
      })
    }

    return null
  }

  return {
    db,
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
  config: OpenSaaSConfig,
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
  context: AccessContext,
  config: OpenSaaSConfig,
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
  context: AccessContext,
  config: OpenSaaSConfig,
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
      { ...context, prisma: prisma as any },
      'create',
    )

    // 6. Execute beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: 'create',
      context,
    })

    // 7. Execute database create
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
  context: AccessContext,
  config: OpenSaaSConfig,
) {
  return async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    // 1. Fetch the item to pass to access control and hooks
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matchesFilter = await (model as any).findFirst({
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
      { ...context, prisma: prisma as any },
      'update',
    )

    // 7. Execute beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: 'update',
      item,
      context,
    })

    // 8. Execute database update
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (model as any).update({
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
  context: AccessContext,
) {
  return async (args: { where: { id: string } }) => {
    // 1. Fetch the item to pass to access control and hooks
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matchesFilter = await (model as any).findFirst({
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleted = await (model as any).delete({
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[getDbKey(listName)]
    const count = await model.count({
      where,
    })

    return count
  }
}
