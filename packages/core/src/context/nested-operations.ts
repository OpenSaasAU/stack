import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'
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
      // 1. Check create access
      const createAccess = relatedListConfig.access?.operation?.create
      const accessResult = await checkAccess(createAccess, {
        session: context.session,
        context,
      })

      if (accessResult === false) {
        throw new Error('Access denied: Cannot create related item')
      }

      // 2. Execute list-level resolveInput hook
      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        operation: 'create',
        resolvedData: item,
        context,
      })

      // 2.5. Execute field-level resolveInput hooks
      // We need to get the list name for this related config
      // Since we don't have it directly, we'll need to find it from the config
      let relatedListName = ''
      for (const [listKey, listCfg] of Object.entries(config.lists)) {
        if (listCfg === relatedListConfig) {
          relatedListName = listKey
          break
        }
      }

      resolvedData = await executeFieldResolveInputHooks(
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
        relatedListName,
      )

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  prisma: unknown,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const connectionsArray = Array.isArray(connections) ? connections : [connections]

  // Check update access for each item being connected
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

      // Execute list-level resolveInput hook
      const updateData = (update as Record<string, unknown>).data as Record<string, unknown>
      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        operation: 'update',
        resolvedData: updateData,
        item,
        context,
      })

      // Execute field-level resolveInput hooks
      resolvedData = await executeFieldResolveInputHooks(
        resolvedData,
        relatedListConfig.fields,
        'update',
        context,
        relatedListName,
        item,
      )

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

      // Check access for the connect portion (try to find existing item)
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

      return {
        where: (op as Record<string, unknown>).where,
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

    // Process different nested operation types
    const nestedOp: Record<string, unknown> = {}
    const valueRecord = value as Record<string, unknown>

    if (valueRecord.create !== undefined) {
      nestedOp.create = await processNestedCreate(
        valueRecord.create as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListConfig,
        context,
        config,
      )
    }

    if (valueRecord.connect !== undefined) {
      nestedOp.connect = await processNestedConnect(
        valueRecord.connect as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListName,
        relatedListConfig,
        context,
        context.prisma,
      )
    }

    if (valueRecord.connectOrCreate !== undefined) {
      nestedOp.connectOrCreate = await processNestedConnectOrCreate(
        valueRecord.connectOrCreate as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListName,
        relatedListConfig,
        context,
        config,
        context.prisma,
      )
    }

    if (valueRecord.update !== undefined) {
      nestedOp.update = await processNestedUpdate(
        valueRecord.update as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListName,
        relatedListConfig,
        context,
        config,
        context.prisma,
      )
    }

    // For other operations, pass through (disconnect, delete, set, etc.)
    // These will be subject to Prisma's own constraints
    if (valueRecord.disconnect !== undefined) {
      nestedOp.disconnect = valueRecord.disconnect
    }

    if (valueRecord.delete !== undefined) {
      nestedOp.delete = valueRecord.delete
    }

    if (valueRecord.deleteMany !== undefined) {
      nestedOp.deleteMany = valueRecord.deleteMany
    }

    if (valueRecord.set !== undefined) {
      nestedOp.set = valueRecord.set
    }

    if (valueRecord.updateMany !== undefined) {
      nestedOp.updateMany = valueRecord.updateMany
    }

    processed[fieldName] = nestedOp
  }

  return processed
}
