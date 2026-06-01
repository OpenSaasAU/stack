import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { checkAccess, filterWritableFields, getRelatedListConfig } from '../access/index.js'
import {
  executeResolveInput,
  executeValidate,
  executeFieldResolveInputHooks,
  validateFieldRules,
  ValidationError,
} from '../hooks/index.js'
import { getDbKey } from '../lib/case-utils.js'

/**
 * Check if a field config is a relationship field
 */
function isRelationshipField(fieldConfig: FieldConfig | undefined): boolean {
  return fieldConfig?.type === 'relationship'
}

/**
 * Process nested create operations
 * Applies hooks and access control to each item being created
 */
async function processNestedCreate(
  items: Record<string, unknown> | Array<Record<string, unknown>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  config: OpenSaasConfig,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const itemsArray = Array.isArray(items) ? items : [items]

  const processedItems = await Promise.all(
    itemsArray.map(async (item) => {
      // 1. Check create access (skip if sudo mode)
      if (!context._isSudo) {
        const createAccess = relatedListConfig.access?.operation?.create
        const accessResult = await checkAccess(createAccess, {
          session: context.session,
          context,
        })

        if (accessResult === false) {
          throw new Error('Access denied: Cannot create related item')
        }
      }

      // 2. Get the list name for this related config
      let relatedListName = ''
      for (const [listKey, listCfg] of Object.entries(config.lists)) {
        if (listCfg === relatedListConfig) {
          relatedListName = listKey
          break
        }
      }

      // 3. Execute list-level resolveInput hook
      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'create',
        inputData: item,
        resolvedData: item,
        item: undefined,
        context,
      })

      // 4. Execute field-level resolveInput hooks
      resolvedData = await executeFieldResolveInputHooks(
        item,
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
        relatedListName,
      )

      // 5. Execute validate hook
      await executeValidate(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'create',
        inputData: item,
        resolvedData,
        item: undefined,
        context,
      })

      // 4. Field validation
      const validation = validateFieldRules(resolvedData, relatedListConfig.fields, 'create')
      if (validation.errors.length > 0) {
        throw new ValidationError(validation.errors, validation.fieldErrors)
      }

      // 5. Filter writable fields
      const filtered = await filterWritableFields(
        resolvedData,
        relatedListConfig.fields,
        'create',
        {
          session: context.session,
          context,
          inputData: item,
        },
      )

      // 6. Recursively process nested operations in this item
      return await processNestedOperations(
        filtered,
        relatedListConfig.fields,
        config,
        context,
        'create',
      )
    }),
  )

  return Array.isArray(items) ? processedItems : processedItems[0]
}

/**
 * Process nested connect operations
 * Verifies update access to the items being connected
 */
async function processNestedConnect(
  connections: Record<string, unknown> | Array<Record<string, unknown>>,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  prisma: unknown,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const connectionsArray = Array.isArray(connections) ? connections : [connections]

  // Check update access for each item being connected (skip if sudo mode)
  if (!context._isSudo) {
    for (const connection of connectionsArray) {
      // Access Prisma model dynamically - required because model names are generated at runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (prisma as any)[getDbKey(relatedListName)]

      // Fetch the item to check access
      const item = await model.findUnique({
        where: connection,
      })

      if (!item) {
        throw new Error(`Cannot connect: Item not found`)
      }

      // Check update access (connecting modifies the relationship)
      const updateAccess = relatedListConfig.access?.operation?.update
      const accessResult = await checkAccess(updateAccess, {
        session: context.session,
        item,
        context,
      })

      if (accessResult === false) {
        throw new Error('Access denied: Cannot connect to this item')
      }

      // If access returns a filter, check if item matches
      if (typeof accessResult === 'object') {
        // Simple field matching
        for (const [key, value] of Object.entries(accessResult)) {
          if (typeof value === 'object' && value !== null && 'equals' in value) {
            if (item[key] !== (value as Record<string, unknown>).equals) {
              throw new Error('Access denied: Cannot connect to this item')
            }
          } else if (item[key] !== value) {
            throw new Error('Access denied: Cannot connect to this item')
          }
        }
      }
    }
  }

  return connections
}

/**
 * Process nested update operations
 * Applies hooks and access control to updates
 */
async function processNestedUpdate(
  updates: Record<string, unknown> | Array<Record<string, unknown>>,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  config: OpenSaasConfig,
  prisma: unknown,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const updatesArray = Array.isArray(updates) ? updates : [updates]

  const processedUpdates = await Promise.all(
    updatesArray.map(async (update) => {
      // Access Prisma model dynamically - required because model names are generated at runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (prisma as any)[getDbKey(relatedListName)]

      // Fetch the existing item
      const item = await model.findUnique({
        where: (update as Record<string, unknown>).where,
      })

      if (!item) {
        throw new Error('Cannot update: Item not found')
      }

      // Check update access (skip if sudo mode)
      if (!context._isSudo) {
        const updateAccess = relatedListConfig.access?.operation?.update
        const accessResult = await checkAccess(updateAccess, {
          session: context.session,
          item,
          context,
        })

        if (accessResult === false) {
          throw new Error('Access denied: Cannot update related item')
        }
      }

      // Execute list-level resolveInput hook
      const updateData = (update as Record<string, unknown>).data as Record<string, unknown>
      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'update',
        inputData: updateData,
        resolvedData: updateData,
        item,
        context,
      })

      // Execute field-level resolveInput hooks
      resolvedData = await executeFieldResolveInputHooks(
        updateData,
        resolvedData,
        relatedListConfig.fields,
        'update',
        context,
        relatedListName,
        item,
      )

      // Execute validate hook
      await executeValidate(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'update',
        inputData: updateData,
        resolvedData,
        item,
        context,
      })

      // Field validation
      const validation = validateFieldRules(resolvedData, relatedListConfig.fields, 'update')
      if (validation.errors.length > 0) {
        throw new ValidationError(validation.errors, validation.fieldErrors)
      }

      // Filter writable fields
      const filtered = await filterWritableFields(
        resolvedData,
        relatedListConfig.fields,
        'update',
        {
          session: context.session,
          item,
          context,
          inputData: updateData,
        },
      )

      // Recursively process nested operations
      const processedData = await processNestedOperations(
        filtered,
        relatedListConfig.fields,
        config,
        context,
        'update',
      )

      return {
        where: (update as Record<string, unknown>).where,
        data: processedData,
      }
    }),
  )

  return Array.isArray(updates) ? processedUpdates : processedUpdates[0]
}

/**
 * Process nested connectOrCreate operations
 */
async function processNestedConnectOrCreate(
  operations: Record<string, unknown> | Array<Record<string, unknown>>,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  config: OpenSaasConfig,
  prisma: unknown,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const operationsArray = Array.isArray(operations) ? operations : [operations]

  const processedOps = await Promise.all(
    operationsArray.map(async (op) => {
      // Process the create portion through create hooks
      const opRecord = op as Record<string, unknown>
      const processedCreate = await processNestedCreate(
        opRecord.create as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListConfig,
        context,
        config,
      )

      // Check access for the connect portion (try to find existing item) (skip if sudo mode)
      if (!context._isSudo) {
        try {
          // Access Prisma model dynamically - required because model names are generated at runtime
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const model = (prisma as any)[getDbKey(relatedListName)]
          const existingItem = await model.findUnique({
            where: opRecord.where,
          })

          if (existingItem) {
            // Check update access for connection
            const updateAccess = relatedListConfig.access?.operation?.update
            const accessResult = await checkAccess(updateAccess, {
              session: context.session,
              item: existingItem,
              context,
            })

            if (accessResult === false) {
              throw new Error('Access denied: Cannot connect to existing item')
            }
          }
        } catch {
          // Item doesn't exist, will use create (already processed)
        }
      }

      return {
        where: (op as Record<string, unknown>).where,
        create: processedCreate,
      }
    }),
  )

  return Array.isArray(operations) ? processedOps : processedOps[0]
}

/**
 * Arguments passed to every nested-operation handler.
 *
 * A handler receives the raw value supplied for a single nested-op kind
 * (e.g. the contents of `value.create`) alongside everything it needs to apply
 * hooks, access control, and recursion.
 */
interface NestedOpHandlerArgs {
  /** Raw payload supplied for this nested-op kind (e.g. the value of `value.create`). */
  value: unknown
  /** The list name of the related model (e.g. `'User'`). */
  relatedListName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>
  context: AccessContext
  config: OpenSaasConfig
  /** Prisma client used for dynamic model access during access checks. */
  prisma: unknown
}

/**
 * A nested-operation handler describes how a single nested-op kind
 * (`create`, `connect`, …) is processed before it reaches Prisma.
 *
 * Adding support for a new nested-op kind means registering a new entry in
 * {@link nestedOpRegistry}, not editing the dispatch loop.
 */
interface NestedOpHandler {
  /** Produce the processed payload for this nested-op kind. */
  execute(args: NestedOpHandlerArgs): Promise<unknown>
}

/**
 * Registry of nested-operation handlers keyed by nested-op kind.
 *
 * The dispatch loop in {@link processNestedOperations} looks handlers up here
 * instead of branching on each kind. Kinds that require hooks/access control
 * (`create`, `connect`, `connectOrCreate`, `update`) provide an `execute` that
 * applies them; pass-through kinds (`disconnect`, `delete`, `deleteMany`,
 * `set`, `updateMany`) return their value unchanged so Prisma's own
 * constraints apply.
 */
const nestedOpRegistry: Record<string, NestedOpHandler> = {
  create: {
    execute: ({ value, relatedListConfig, context, config }) =>
      processNestedCreate(
        value as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListConfig,
        context,
        config,
      ),
  },
  connect: {
    execute: ({ value, relatedListName, relatedListConfig, context, prisma }) =>
      processNestedConnect(
        value as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListName,
        relatedListConfig,
        context,
        prisma,
      ),
  },
  connectOrCreate: {
    execute: ({ value, relatedListName, relatedListConfig, context, config, prisma }) =>
      processNestedConnectOrCreate(
        value as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListName,
        relatedListConfig,
        context,
        config,
        prisma,
      ),
  },
  update: {
    execute: ({ value, relatedListName, relatedListConfig, context, config, prisma }) =>
      processNestedUpdate(
        value as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListName,
        relatedListConfig,
        context,
        config,
        prisma,
      ),
  },
  // Pass-through kinds: no hooks/access control, left to Prisma's own constraints.
  disconnect: { execute: ({ value }) => Promise.resolve(value) },
  delete: { execute: ({ value }) => Promise.resolve(value) },
  deleteMany: { execute: ({ value }) => Promise.resolve(value) },
  set: { execute: ({ value }) => Promise.resolve(value) },
  updateMany: { execute: ({ value }) => Promise.resolve(value) },
}

/**
 * Order in which nested-op kinds are processed for a single relationship field.
 *
 * Mirrors the historical in-place dispatch order so behaviour is preserved.
 */
const nestedOpOrder = [
  'create',
  'connect',
  'connectOrCreate',
  'update',
  'disconnect',
  'delete',
  'deleteMany',
  'set',
  'updateMany',
] as const

/**
 * Process the nested relationship operations supplied for a single
 * relationship field's value, dispatching each present nested-op kind through
 * the {@link nestedOpRegistry}.
 */
async function processFieldNestedOps(
  valueRecord: Record<string, unknown>,
  args: Omit<NestedOpHandlerArgs, 'value'>,
): Promise<Record<string, unknown>> {
  const nestedOp: Record<string, unknown> = {}

  for (const kind of nestedOpOrder) {
    const value = valueRecord[kind]
    if (value === undefined) {
      continue
    }

    const handler = nestedOpRegistry[kind]
    nestedOp[kind] = await handler.execute({ ...args, value })
  }

  return nestedOp
}

/**
 * Process all nested operations in a data payload
 * Recursively handles relationship fields with nested writes
 */
export async function processNestedOperations(
  data: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  context: AccessContext & { prisma: unknown },
  operation: 'create' | 'update',
  depth: number = 0,
): Promise<Record<string, unknown>> {
  const MAX_DEPTH = 5

  if (depth >= MAX_DEPTH) {
    return data
  }

  const processed: Record<string, unknown> = {}

  for (const [fieldName, value] of Object.entries(data)) {
    const fieldConfig = fieldConfigs[fieldName]

    // If not a relationship field or no value, pass through
    if (!isRelationshipField(fieldConfig) || value === null || value === undefined) {
      processed[fieldName] = value
      continue
    }

    // Get related list config
    const relationshipField = fieldConfig as { type: 'relationship'; ref: string }
    const relatedConfig = getRelatedListConfig(relationshipField.ref, config)
    if (!relatedConfig) {
      processed[fieldName] = value
      continue
    }

    const { listName: relatedListName, listConfig: relatedListConfig } = relatedConfig

    // Dispatch each present nested-op kind through the handler registry.
    processed[fieldName] = await processFieldNestedOps(value as Record<string, unknown>, {
      relatedListName,
      relatedListConfig,
      context,
      config,
      prisma: context.prisma,
    })
  }

  return processed
}
