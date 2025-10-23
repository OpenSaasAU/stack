import type { OpenSaaSConfig, ListConfig, FieldConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { checkAccess, filterWritableFields, getRelatedListConfig } from '../access/index.js'
import {
  executeResolveInput,
  executeValidateInput,
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
  relatedListConfig: ListConfig,
  context: AccessContext,
  config: OpenSaaSConfig,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const itemsArray = Array.isArray(items) ? items : [items]

  const processedItems = await Promise.all(
    itemsArray.map(async (item) => {
      // 1. Check create access
      const createAccess = relatedListConfig.access?.operation?.create
      const accessResult = await checkAccess(createAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        throw new Error('Access denied: Cannot create related item')
      }

      // 2. Execute resolveInput hook
      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        operation: 'create',
        resolvedData: item,
        context,
      })

      // 3. Execute validateInput hook
      await executeValidateInput(relatedListConfig.hooks, {
        operation: 'create',
        resolvedData,
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
  relatedListConfig: ListConfig,
  context: AccessContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const connectionsArray = Array.isArray(connections) ? connections : [connections]

  // Check update access for each item being connected
  for (const connection of connectionsArray) {
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

  return connections
}

/**
 * Process nested update operations
 * Applies hooks and access control to updates
 */
async function processNestedUpdate(
  updates: Record<string, unknown> | Array<Record<string, unknown>>,
  relatedListName: string,
  relatedListConfig: ListConfig,
  context: AccessContext,
  config: OpenSaaSConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const updatesArray = Array.isArray(updates) ? updates : [updates]

  const processedUpdates = await Promise.all(
    updatesArray.map(async (update) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (prisma as any)[getDbKey(relatedListName)]

      // Fetch the existing item
      const item = await model.findUnique({
        where: update.where,
      })

      if (!item) {
        throw new Error('Cannot update: Item not found')
      }

      // Check update access
      const updateAccess = relatedListConfig.access?.operation?.update
      const accessResult = await checkAccess(updateAccess, {
        session: context.session,
        item,
        context,
      })

      if (accessResult === false) {
        throw new Error('Access denied: Cannot update related item')
      }

      // Execute resolveInput hook

      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        operation: 'update',
        resolvedData: (update as any).data,
        item,
        context,
      })

      // Execute validateInput hook
      await executeValidateInput(relatedListConfig.hooks, {
        operation: 'update',
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
        where: update.where,
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
  relatedListConfig: ListConfig,
  context: AccessContext,
  config: OpenSaaSConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const operationsArray = Array.isArray(operations) ? operations : [operations]

  const processedOps = await Promise.all(
    operationsArray.map(async (op) => {
      // Process the create portion through create hooks

      const processedCreate = await processNestedCreate(
        (op as any).create,
        relatedListConfig,
        context,
        config,
      )

      // Check access for the connect portion (try to find existing item)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = (prisma as any)[getDbKey(relatedListName)]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingItem = await (model as any).findUnique({
          where: (op as any).where,
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

      return {
        where: (op as any).where,
        create: processedCreate,
      }
    }),
  )

  return Array.isArray(operations) ? processedOps : processedOps[0]
}

/**
 * Process all nested operations in a data payload
 * Recursively handles relationship fields with nested writes
 */
export async function processNestedOperations(
  data: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaaSConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: AccessContext & { prisma: any },
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

    // Process different nested operation types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nestedOp: any = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valueAny = value as any

    if (valueAny.create !== undefined) {
      nestedOp.create = await processNestedCreate(
        valueAny.create,
        relatedListConfig,
        context,
        config,
      )
    }

    if (valueAny.connect !== undefined) {
      nestedOp.connect = await processNestedConnect(
        valueAny.connect,
        relatedListName,
        relatedListConfig,
        context,
        context.prisma,
      )
    }

    if (valueAny.connectOrCreate !== undefined) {
      nestedOp.connectOrCreate = await processNestedConnectOrCreate(
        valueAny.connectOrCreate,
        relatedListName,
        relatedListConfig,
        context,
        config,
        context.prisma,
      )
    }

    if (valueAny.update !== undefined) {
      nestedOp.update = await processNestedUpdate(
        valueAny.update,
        relatedListName,
        relatedListConfig,
        context,
        config,
        context.prisma,
      )
    }

    // For other operations, pass through (disconnect, delete, set, etc.)
    // These will be subject to Prisma's own constraints
    if (valueAny.disconnect !== undefined) {
      nestedOp.disconnect = valueAny.disconnect
    }

    if (valueAny.delete !== undefined) {
      nestedOp.delete = valueAny.delete
    }

    if (valueAny.deleteMany !== undefined) {
      nestedOp.deleteMany = valueAny.deleteMany
    }

    if (valueAny.set !== undefined) {
      nestedOp.set = valueAny.set
    }

    if (valueAny.updateMany !== undefined) {
      nestedOp.updateMany = valueAny.updateMany
    }

    processed[fieldName] = nestedOp
  }

  return processed
}
