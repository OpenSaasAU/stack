import type { OpenSaaSConfig, ListConfig } from "../config/types.js";
import type { Session, AccessContext } from "../access/index.js";
import {
  checkAccess,
  mergeFilters,
  filterReadableFields,
  filterWritableFields,
} from "../access/index.js";
import {
  executeResolveInput,
  executeValidateInput,
  executeBeforeOperation,
  executeAfterOperation,
  validateFieldRules,
  ValidationError,
} from "../hooks/index.js";
import { processNestedOperations } from "./nested-operations.js";

/**
 * Prisma-like client type
 * This allows the context to work with any Prisma client without importing @prisma/client
 */
export type PrismaClientLike = {
  [key: string]: any;
};

/**
 * Create an access-controlled context
 *
 * @param config - OpenSaaS configuration
 * @param prisma - Your Prisma client instance (pass as generic for type safety)
 * @param session - Current session object (or null if not authenticated)
 */
export async function getContext<TPrisma extends PrismaClientLike = any>(
  config: OpenSaaSConfig,
  prisma: TPrisma,
  session: Session,
): Promise<any> {
  const context: AccessContext = {
    session,
    prisma,
  };

  const db: Record<string, any> = {};

  // Create access-controlled operations for each list
  for (const [listName, listConfig] of Object.entries(config.lists)) {
    const lowerListName = listName.toLowerCase();

    db[lowerListName] = {
      findUnique: createFindUnique(listName, listConfig, prisma, context, config),
      findMany: createFindMany(listName, listConfig, prisma, context, config),
      create: createCreate(listName, listConfig, prisma, context, config),
      update: createUpdate(listName, listConfig, prisma, context, config),
      delete: createDelete(listName, listConfig, prisma, context, config),
      count: createCount(listName, listConfig, prisma, context, config),
    };
  }

  // Generic server action handler
  async function serverAction(props: {
    listKey: string;
    action: "create" | "update" | "delete";
    data?: Record<string, any>;
    id?: string;
  }) {
    const dbKey = props.listKey.toLowerCase();

    if (props.action === "create") {
      return await db[dbKey].create({ data: props.data });
    } else if (props.action === "update") {
      return await db[dbKey].update({
        where: { id: props.id },
        data: props.data,
      });
    } else if (props.action === "delete") {
      return await db[dbKey].delete({
        where: { id: props.id },
      });
    }

    return null;
  }

  return {
    db,
    session,
    prisma,
    serverAction,
  };
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
  return async (args: { where: { id: string }; include?: any }) => {
    // Check query access
    const queryAccess = listConfig.access?.operation?.query;
    const accessResult = await checkAccess(queryAccess, {
      session: context.session,
      context,
    });

    if (accessResult === false) {
      return null;
    }

    // Merge access filter with where clause
    const where = mergeFilters(args.where, accessResult);
    if (where === null) {
      return null;
    }

    // Execute query
    const model = (prisma as any)[listName.toLowerCase()];
    const item = await model.findFirst({
      where,
      include: args.include,
    });

    if (!item) {
      return null;
    }

    // Filter readable fields
    const filtered = await filterReadableFields(
      item,
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
    );

    return filtered;
  };
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
    where?: any;
    take?: number;
    skip?: number;
    include?: any;
  }) => {
    // Check query access
    const queryAccess = listConfig.access?.operation?.query;
    const accessResult = await checkAccess(queryAccess, {
      session: context.session,
      context,
    });

    if (accessResult === false) {
      return [];
    }

    // Merge access filter with where clause
    const where = mergeFilters(args?.where, accessResult);
    if (where === null) {
      return [];
    }

    // Execute query
    const model = (prisma as any)[listName.toLowerCase()];
    const items = await model.findMany({
      where,
      take: args?.take,
      skip: args?.skip,
      include: args?.include,
    });

    // Filter readable fields for each item
    const filtered = await Promise.all(
      items.map((item: any) =>
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
    );

    return filtered;
  };
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
  return async (args: { data: any }) => {
    // 1. Check create access
    const createAccess = listConfig.access?.operation?.create;
    const accessResult = await checkAccess(createAccess, {
      session: context.session,
      context,
    });

    if (accessResult === false) {
      return null;
    }

    // 2. Execute resolveInput hook
    let resolvedData = await executeResolveInput(listConfig.hooks, {
      operation: "create",
      resolvedData: args.data,
      context,
    });

    // 3. Execute validateInput hook
    await executeValidateInput(listConfig.hooks, {
      operation: "create",
      resolvedData,
      context,
    });

    // 4. Field validation (isRequired, length, etc.)
    const fieldErrors = validateFieldRules(
      resolvedData,
      listConfig.fields,
      "create",
    );
    if (fieldErrors.length > 0) {
      throw new ValidationError(fieldErrors);
    }

    // 5. Filter writable fields (field-level access control)
    const filteredData = await filterWritableFields(
      resolvedData,
      listConfig.fields,
      "create",
      {
        session: context.session,
        context,
      },
    );

    // 5.5. Process nested relationship operations
    const data = await processNestedOperations(
      filteredData,
      listConfig.fields,
      config,
      { ...context, prisma },
      "create",
    );

    // 6. Execute beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: "create",
      context,
    });

    // 7. Execute database create
    const model = (prisma as any)[listName.toLowerCase()];
    const item = await model.create({
      data,
    });

    // 8. Execute afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: "create",
      item,
      context,
    });

    // 9. Filter readable fields
    const filtered = await filterReadableFields(
      item,
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
    );

    return filtered;
  };
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
  return async (args: { where: { id: string }; data: any }) => {
    // 1. Fetch the item to pass to access control and hooks
    const model = (prisma as any)[listName.toLowerCase()];
    const item = await model.findUnique({
      where: args.where,
    });

    if (!item) {
      return null;
    }

    // 2. Check update access
    const updateAccess = listConfig.access?.operation?.update;
    const accessResult = await checkAccess(updateAccess, {
      session: context.session,
      item,
      context,
    });

    if (accessResult === false) {
      return null;
    }

    // If access returns a filter, check if item matches
    if (typeof accessResult === "object") {
      const matchesFilter = await model.findFirst({
        where: mergeFilters(args.where, accessResult),
      });

      if (!matchesFilter) {
        return null;
      }
    }

    // 3. Execute resolveInput hook
    let resolvedData = await executeResolveInput(listConfig.hooks, {
      operation: "update",
      resolvedData: args.data,
      item,
      context,
    });

    // 4. Execute validateInput hook
    await executeValidateInput(listConfig.hooks, {
      operation: "update",
      resolvedData,
      item,
      context,
    });

    // 5. Field validation (isRequired, length, etc.)
    const fieldErrors = validateFieldRules(
      resolvedData,
      listConfig.fields,
      "update",
    );
    if (fieldErrors.length > 0) {
      throw new ValidationError(fieldErrors);
    }

    // 6. Filter writable fields (field-level access control)
    const filteredData = await filterWritableFields(
      resolvedData,
      listConfig.fields,
      "update",
      {
        session: context.session,
        item,
        context,
      },
    );

    // 6.5. Process nested relationship operations
    const data = await processNestedOperations(
      filteredData,
      listConfig.fields,
      config,
      { ...context, prisma },
      "update",
    );

    // 7. Execute beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: "update",
      item,
      context,
    });

    // 8. Execute database update
    const updated = await model.update({
      where: args.where,
      data,
    });

    // 9. Execute afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: "update",
      item: updated,
      context,
    });

    // 10. Filter readable fields
    const filtered = await filterReadableFields(
      updated,
      listConfig.fields,
      {
        session: context.session,
        context,
      },
      config,
    );

    return filtered;
  };
}

/**
 * Create delete operation with access control and hooks
 */
function createDelete<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext,
  config: OpenSaaSConfig,
) {
  return async (args: { where: { id: string } }) => {
    // 1. Fetch the item to pass to access control and hooks
    const model = (prisma as any)[listName.toLowerCase()];
    const item = await model.findUnique({
      where: args.where,
    });

    if (!item) {
      return null;
    }

    // 2. Check delete access
    const deleteAccess = listConfig.access?.operation?.delete;
    const accessResult = await checkAccess(deleteAccess, {
      session: context.session,
      item,
      context,
    });

    if (accessResult === false) {
      return null;
    }

    // If access returns a filter, check if item matches
    if (typeof accessResult === "object") {
      const matchesFilter = await model.findFirst({
        where: mergeFilters(args.where, accessResult),
      });

      if (!matchesFilter) {
        return null;
      }
    }

    // 3. Execute beforeOperation hook
    await executeBeforeOperation(listConfig.hooks, {
      operation: "delete",
      item,
      context,
    });

    // 4. Execute database delete
    const deleted = await model.delete({
      where: args.where,
    });

    // 5. Execute afterOperation hook
    await executeAfterOperation(listConfig.hooks, {
      operation: "delete",
      item: deleted,
      context,
    });

    return deleted;
  };
}

/**
 * Create count operation with access control
 */
function createCount<TPrisma extends PrismaClientLike>(
  listName: string,
  listConfig: ListConfig,
  prisma: TPrisma,
  context: AccessContext,
  config: OpenSaaSConfig,
) {
  return async (args?: { where?: any }) => {
    // Check query access
    const queryAccess = listConfig.access?.operation?.query;
    const accessResult = await checkAccess(queryAccess, {
      session: context.session,
      context,
    });

    if (accessResult === false) {
      return 0;
    }

    // Merge access filter with where clause
    const where = mergeFilters(args?.where, accessResult);
    if (where === null) {
      return 0;
    }

    // Execute count
    const model = (prisma as any)[listName.toLowerCase()];
    const count = await model.count({
      where,
    });

    return count;
  };
}
