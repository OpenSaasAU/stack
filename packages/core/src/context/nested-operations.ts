import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import { checkAccess, filterWritableFields, getRelatedListConfig } from '../access/index.js'
import {
  executeResolveInput,
  executeValidate,
  executeFieldResolveInputHooks,
  executeBeforeOperation,
  executeAfterOperation,
  executeFieldBeforeOperationHooks,
  executeFieldAfterOperationHooks,
  executeFieldValidateHooks,
  validateFieldRules,
  ValidationError,
} from '../hooks/index.js'
import { getDbKey } from '../lib/case-utils.js'

/**
 * Nested writes (#569 / ADR-0010).
 *
 * Nested `create`/`update`/`delete` must fire the SAME list- and field-level
 * `beforeOperation`/`afterOperation` as the equivalent top-level write, so a
 * record's side effects are identical whether it was written nested or
 * top-level. Persistence itself is still performed by Prisma's single nested
 * write (so Prisma keeps owning FK ordering and intra-statement atomicity); we
 * run the nested records' `beforeOperation` BEFORE that persist and their
 * `afterOperation` AFTER it, all inside the one interactive transaction the
 * Write Pipeline opens.
 *
 * Mechanism (per ADR-0010, "hooks around a single nested persist"):
 *   - `processNestedOperations` runs nested resolveInput/validate/field-rules
 *     (as before) AND nested `beforeOperation`, and returns the transformed
 *     payload together with a list of deferred {@link AfterTask}s.
 *   - The Write Pipeline persists the parent (with the nested relations
 *     `include`d so the persisted nested rows come back), then calls
 *     {@link runAfterTasks} so each nested record's `afterOperation` fires with
 *     a real persisted `item` and (for update/delete) its `originalItem`.
 *   - Everything runs inside the transaction, so a throwing `beforeOperation`/
 *     `afterOperation` rolls back the whole write.
 */

/**
 * A deferred nested `afterOperation` task, run after the parent has persisted.
 * It receives the persisted parent row (with nested relations included) so it
 * can recover the persisted nested `item`.
 */
export interface AfterTask {
  /** Field name on the parent linking to the related list (for include lookup). */
  fieldName: string
  run(parentResult: Record<string, unknown>): Promise<void>
}

/**
 * Result of processing nested operations: the transformed write payload plus
 * the deferred `afterOperation` tasks and the relation fields the parent write
 * must `include` so those tasks can recover their persisted `item`.
 */
export interface NestedOpsResult {
  /** The transformed write payload handed to Prisma. */
  data: Record<string, unknown>
  /** Deferred `afterOperation` tasks to run after the parent persist. */
  afterTasks: AfterTask[]
  /** Relationship field names to `include` in the parent write result. */
  includeFields: Set<string>
}

/**
 * Check if a field config is a relationship field
 */
function isRelationshipField(fieldConfig: FieldConfig | undefined): boolean {
  return fieldConfig?.type === 'relationship'
}

/**
 * Resolve the related list name for a related list config (config object identity).
 */
function findListName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  config: OpenSaasConfig,
): string {
  for (const [listKey, listCfg] of Object.entries(config.lists)) {
    if (listCfg === relatedListConfig) {
      return listKey
    }
  }
  return ''
}

/**
 * Read back a single persisted nested row from the parent result.
 *
 * For a to-one relation the included value is the row itself. For a to-many
 * relation it is an array; the newly-created/updated row is identified by its
 * known id (update) or by excluding the ids that already existed before the
 * write (create), falling back to the last array entry.
 */
function recoverPersistedRow(
  parentResult: Record<string, unknown>,
  fieldName: string,
  knownId: string | undefined,
  excludeIds: Set<string>,
): Record<string, unknown> | undefined {
  const included = parentResult[fieldName]
  if (included == null) return undefined

  if (Array.isArray(included)) {
    const rows = included as Array<Record<string, unknown>>
    if (knownId !== undefined) {
      const match = rows.find((r) => r.id === knownId)
      if (match) return match
    }
    const fresh = rows.filter((r) => typeof r.id === 'string' && !excludeIds.has(r.id as string))
    if (fresh.length > 0) return fresh[fresh.length - 1]
    return rows[rows.length - 1]
  }

  return included as Record<string, unknown>
}

/**
 * Process nested create operations.
 *
 * Runs the target list's full input pipeline (resolveInput → validate →
 * field-rules → filter-writable → recurse) AND its `beforeOperation`, then
 * registers an `afterOperation` task keyed to the parent's included relation.
 */
async function processNestedCreate(
  items: Record<string, unknown> | Array<Record<string, unknown>>,
  fieldName: string,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  config: OpenSaasConfig,
  prisma: unknown,
  afterTasks: AfterTask[],
  excludeIds: Set<string>,
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

      // 2. Execute list-level resolveInput hook
      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'create',
        inputData: item,
        resolvedData: item,
        item: undefined,
        context,
      })

      // 3. Execute field-level resolveInput hooks
      resolvedData = await executeFieldResolveInputHooks(
        item,
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
        relatedListName,
      )

      // 4. Execute validate hook
      await executeValidate(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'create',
        inputData: item,
        resolvedData,
        item: undefined,
        context,
      })

      // 4.5 Field-level validate hooks
      await executeFieldValidateHooks(
        item,
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
        relatedListName,
      )

      // 5. Field validation (built-in rules)
      const validation = validateFieldRules(resolvedData, relatedListConfig.fields, 'create')
      if (validation.errors.length > 0) {
        throw new ValidationError(validation.errors, validation.fieldErrors)
      }

      // 6. Filter writable fields
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

      // 7. Recursively process nested operations in this item
      const { data: nestedData, afterTasks: childAfterTasks } = await processNestedOperations(
        filtered,
        relatedListConfig.fields,
        config,
        { ...context, prisma },
        'create',
      )

      // 8. Field-level beforeOperation (side effects) for this nested create
      await executeFieldBeforeOperationHooks(
        item,
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
        relatedListName,
      )

      // 9. List-level beforeOperation for this nested create
      await executeBeforeOperation(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'create',
        inputData: item,
        resolvedData,
        context,
      })

      // 10. Register afterOperation: fires once the parent (and thus this nested
      // row) has persisted. The persisted row is recovered from the parent's
      // included relation.
      afterTasks.push({
        fieldName,
        run: async (parentResult) => {
          const persisted = recoverPersistedRow(parentResult, fieldName, undefined, excludeIds)
          const createdItem = persisted ?? {}

          await executeAfterOperation(relatedListConfig.hooks, {
            listKey: relatedListName,
            operation: 'create',
            inputData: item,
            item: createdItem,
            resolvedData,
            context,
          })

          await executeFieldAfterOperationHooks(
            createdItem,
            item,
            resolvedData,
            relatedListConfig.fields,
            'create',
            context,
            relatedListName,
          )

          // Run any deeper nested afterOperation tasks, scoped to the persisted row.
          await runAfterTasks(childAfterTasks, createdItem)
        },
      })

      return nestedData
    }),
  )

  return Array.isArray(items) ? processedItems : processedItems[0]
}

/**
 * Verify that a single connection target is reachable for the caller.
 *
 * Connecting an existing row references it; it does not modify the row's own
 * data. Mirroring Keystone, this requires **read/query** access on the target
 * list (not `update`). When query access returns a filter object, the filter is
 * evaluated in the DATABASE (not in memory) via
 * `findFirst({ where: { AND: [connection, accessFilter] } })`. The connect is
 * allowed iff that query returns a row, which correctly handles arbitrary
 * nested-relation predicates and boolean combinators (`AND`/`OR`/`some`/
 * `none`/`not`). The existence check is folded into the reachability query so a
 * non-existent id is still denied.
 *
 * Sudo bypasses the entire check (handled by the caller).
 */
async function verifyConnectReachable(
  connection: Record<string, unknown>,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  prisma: unknown,
): Promise<void> {
  // Access Prisma model dynamically - required because model names are generated at runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[getDbKey(relatedListName)]

  // Connecting references an existing row; it requires READ (query) access on
  // the target, not update access.
  const queryAccess = relatedListConfig.access?.operation?.query
  const accessResult = await checkAccess(queryAccess, {
    session: context.session,
    context,
  })

  // Explicit denial.
  if (accessResult === false) {
    throw new Error('Access denied: Cannot connect to this item')
  }

  // Full access: still verify the row exists (keep "Item not found" behaviour).
  if (accessResult === true) {
    const item = await model.findUnique({ where: connection })
    if (!item) {
      throw new Error(`Cannot connect: Item not found`)
    }
    return
  }

  // Filter result: confirm the row is reachable under the access filter by
  // AND-combining the connection identifier with the filter and querying the DB.
  // A non-existent id and an unreachable row both yield no row → denied. This
  // correctly evaluates arbitrary nested-relation predicates and boolean
  // combinators because the database does the matching, not an in-memory walk.
  const reachable = await model.findFirst({
    where: { AND: [connection, accessResult] },
  })

  if (!reachable) {
    throw new Error('Access denied: Cannot connect to this item')
  }
}

/**
 * Process nested connect operations.
 * Verifies read (query) access to the items being connected via DB reachability.
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

  // Check read access for each item being connected (skip if sudo mode)
  if (!context._isSudo) {
    for (const connection of connectionsArray) {
      await verifyConnectReachable(connection, relatedListName, relatedListConfig, context, prisma)
    }
  }

  return connections
}

/**
 * Process nested update operations.
 *
 * Runs the target list's full update input pipeline AND its `beforeOperation`,
 * then registers an `afterOperation` task receiving `originalItem` (the row
 * fetched before the write) and the persisted updated `item`.
 */
async function processNestedUpdate(
  updates: Record<string, unknown> | Array<Record<string, unknown>>,
  fieldName: string,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  config: OpenSaasConfig,
  prisma: unknown,
  afterTasks: AfterTask[],
  excludeIds: Set<string>,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const updatesArray = Array.isArray(updates) ? updates : [updates]

  const processedUpdates = await Promise.all(
    updatesArray.map(async (update) => {
      // Access Prisma model dynamically - required because model names are generated at runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (prisma as any)[getDbKey(relatedListName)]

      const where = (update as Record<string, unknown>).where as Record<string, unknown>

      // Fetch the existing item — reused as `originalItem` for afterOperation.
      const originalItem = await model.findUnique({ where })

      if (!originalItem) {
        throw new Error('Cannot update: Item not found')
      }

      // Record the known id so the included-result read-back can find this row
      // (and so it is NOT mistaken for a freshly-created sibling).
      const knownId = typeof originalItem.id === 'string' ? (originalItem.id as string) : undefined
      if (knownId !== undefined) excludeIds.add(knownId)

      // Check update access (skip if sudo mode)
      if (!context._isSudo) {
        const updateAccess = relatedListConfig.access?.operation?.update
        const accessResult = await checkAccess(updateAccess, {
          session: context.session,
          item: originalItem,
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
        item: originalItem,
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
        originalItem,
      )

      // Execute validate hook
      await executeValidate(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'update',
        inputData: updateData,
        resolvedData,
        item: originalItem,
        context,
      })

      // Field-level validate hooks
      await executeFieldValidateHooks(
        updateData,
        resolvedData,
        relatedListConfig.fields,
        'update',
        context,
        relatedListName,
        originalItem,
      )

      // Field validation (built-in rules)
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
          item: originalItem,
          context,
          inputData: updateData,
        },
      )

      // Recursively process nested operations
      const { data: nestedData, afterTasks: childAfterTasks } = await processNestedOperations(
        filtered,
        relatedListConfig.fields,
        config,
        { ...context, prisma },
        'update',
      )

      // Field-level beforeOperation (side effects)
      await executeFieldBeforeOperationHooks(
        updateData,
        resolvedData,
        relatedListConfig.fields,
        'update',
        context,
        relatedListName,
        originalItem,
      )

      // List-level beforeOperation
      await executeBeforeOperation(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'update',
        inputData: updateData,
        item: originalItem,
        resolvedData,
        context,
      })

      // Register afterOperation: fires after the parent persist. The updated row
      // is recovered from the parent's included relation by its known id.
      afterTasks.push({
        fieldName,
        run: async (parentResult) => {
          const persisted = recoverPersistedRow(parentResult, fieldName, knownId, excludeIds)
          const updatedItem = persisted ?? originalItem

          await executeAfterOperation(relatedListConfig.hooks, {
            listKey: relatedListName,
            operation: 'update',
            inputData: updateData,
            originalItem,
            item: updatedItem,
            resolvedData,
            context,
          })

          await executeFieldAfterOperationHooks(
            updatedItem,
            updateData,
            resolvedData,
            relatedListConfig.fields,
            'update',
            context,
            relatedListName,
            originalItem,
          )

          await runAfterTasks(childAfterTasks, updatedItem)
        },
      })

      return {
        where,
        data: nestedData,
      }
    }),
  )

  return Array.isArray(updates) ? processedUpdates : processedUpdates[0]
}

/**
 * Process nested delete operations.
 *
 * Runs the target list's delete pipeline (validate/field-validate +
 * `beforeOperation`) before the parent persist, and registers an
 * `afterOperation` task receiving the `originalItem` (the row before deletion).
 * Persistence is performed by Prisma's nested write; the row no longer exists
 * after, so `originalItem` is the authoritative record for after-hooks.
 */
async function processNestedDelete(
  deletes: Record<string, unknown> | Array<Record<string, unknown>> | boolean,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  prisma: unknown,
  afterTasks: AfterTask[],
): Promise<Record<string, unknown> | Array<Record<string, unknown>> | boolean> {
  // A to-one relation delete can be a boolean (`{ delete: true }`); there is no
  // identifying `where`, so we cannot run target-resolved hooks. Pass through.
  if (typeof deletes === 'boolean') {
    return deletes
  }

  const deletesArray = Array.isArray(deletes) ? deletes : [deletes]

  await Promise.all(
    deletesArray.map(async (del) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (prisma as any)[getDbKey(relatedListName)]

      // A nested delete entry is itself the unique `where` (e.g. `{ id }`).
      const where = del as Record<string, unknown>

      const originalItem = await model.findUnique({ where })
      if (!originalItem) {
        throw new Error('Cannot delete: Item not found')
      }

      // Check delete access (skip if sudo mode)
      if (!context._isSudo) {
        const deleteAccess = relatedListConfig.access?.operation?.delete
        const accessResult = await checkAccess(deleteAccess, {
          session: context.session,
          item: originalItem,
          context,
        })

        if (accessResult === false) {
          throw new Error('Access denied: Cannot delete related item')
        }
      }

      // List-level validate (delete)
      await executeValidate(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'delete',
        item: originalItem,
        context,
      })

      // Field-level validate (delete)
      await executeFieldValidateHooks(
        undefined,
        undefined,
        relatedListConfig.fields,
        'delete',
        context,
        relatedListName,
        originalItem,
      )

      // Field-level beforeOperation (delete)
      await executeFieldBeforeOperationHooks(
        {},
        {},
        relatedListConfig.fields,
        'delete',
        context,
        relatedListName,
        originalItem,
      )

      // List-level beforeOperation (delete)
      await executeBeforeOperation(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'delete',
        item: originalItem,
        context,
      })

      // Register afterOperation: the row is gone after persist, so the
      // originalItem is the authoritative record passed to after-hooks.
      afterTasks.push({
        fieldName: '',
        run: async () => {
          await executeAfterOperation(relatedListConfig.hooks, {
            listKey: relatedListName,
            operation: 'delete',
            originalItem,
            context,
          })

          await executeFieldAfterOperationHooks(
            originalItem,
            undefined,
            undefined,
            relatedListConfig.fields,
            'delete',
            context,
            relatedListName,
            originalItem,
          )
        },
      })
    }),
  )

  return deletes
}

/**
 * Process nested connectOrCreate operations
 */
async function processNestedConnectOrCreate(
  operations: Record<string, unknown> | Array<Record<string, unknown>>,
  fieldName: string,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  config: OpenSaasConfig,
  prisma: unknown,
  afterTasks: AfterTask[],
  excludeIds: Set<string>,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const operationsArray = Array.isArray(operations) ? operations : [operations]

  const processedOps = await Promise.all(
    operationsArray.map(async (op) => {
      const opRecord = op as Record<string, unknown>

      // Check access for the connect portion (skip if sudo mode).
      //
      // connectOrCreate connects an existing row when present, otherwise
      // creates. So when the row exists we apply the same connect semantics as
      // processNestedConnect — READ (query) access on the target, evaluated via
      // DB reachability for filter results. When the row does not exist we fall
      // through to create. We must NOT swallow an access-denied error: only the
      // genuine "row absent" case may fall back to create.
      let rowExists = false
      if (!context._isSudo) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const model = (prisma as any)[getDbKey(relatedListName)]
        const where = opRecord.where as Record<string, unknown>

        const existingItem = await model.findUnique({ where })

        // Only enforce connect access when the row actually exists; otherwise
        // the create branch is used.
        if (existingItem) {
          rowExists = true
          const queryAccess = relatedListConfig.access?.operation?.query
          const accessResult = await checkAccess(queryAccess, {
            session: context.session,
            item: existingItem,
            context,
          })

          if (accessResult === false) {
            throw new Error('Access denied: Cannot connect to existing item')
          }

          // Filter result: confirm the existing row is reachable under the
          // access filter via DB reachability (handles nested/boolean filters).
          if (accessResult !== true) {
            const reachable = await model.findFirst({
              where: { AND: [where, accessResult] },
            })

            if (!reachable) {
              throw new Error('Access denied: Cannot connect to existing item')
            }
          }
        }
      }

      // Process the create portion through the full create pipeline (incl.
      // before/afterOperation). Only register an afterOperation task when the
      // create branch will actually run (row absent), so a pure connect does not
      // fire create hooks. Under sudo we cannot statically know, so we let the
      // create pipeline run its hooks (sudo bypasses access only, not hooks).
      const runCreateHooks = context._isSudo || !rowExists
      const createAfterTasks: AfterTask[] = runCreateHooks ? afterTasks : []
      const processedCreate = await processNestedCreate(
        opRecord.create as Record<string, unknown> | Array<Record<string, unknown>>,
        fieldName,
        relatedListName,
        relatedListConfig,
        context,
        config,
        prisma,
        createAfterTasks,
        excludeIds,
      )

      return {
        where: opRecord.where,
        create: processedCreate,
      }
    }),
  )

  return Array.isArray(operations) ? processedOps : processedOps[0]
}

/**
 * Arguments passed to every nested-operation handler.
 */
interface NestedOpHandlerArgs {
  /** Raw payload supplied for this nested-op kind (e.g. the value of `value.create`). */
  value: unknown
  /** The owning relationship field name on the parent (for include read-back). */
  fieldName: string
  /** The list name of the related model (e.g. `'User'`). */
  relatedListName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>
  context: AccessContext
  config: OpenSaasConfig
  /** Prisma client used for dynamic model access during access checks. */
  prisma: unknown
  /** Collector for deferred nested `afterOperation` tasks. */
  afterTasks: AfterTask[]
  /** Ids known before the write (connect targets + update/delete targets). */
  excludeIds: Set<string>
}

/**
 * A nested-operation handler describes how a single nested-op kind
 * (`create`, `connect`, …) is processed before it reaches Prisma.
 */
interface NestedOpHandler {
  /** Produce the processed payload for this nested-op kind. */
  execute(args: NestedOpHandlerArgs): Promise<unknown>
  /**
   * Whether this kind needs the parent write to `include` the relation so its
   * persisted row can be read back for `afterOperation` (`create`/`update`).
   */
  needsInclude: boolean
}

/**
 * Registry of nested-operation handlers keyed by nested-op kind.
 *
 * Kinds that run the full hook pipeline (`create`, `update`, `delete`, and the
 * create branch of `connectOrCreate`) run `beforeOperation` inline and register
 * deferred `afterOperation` tasks. `connect`/`connectOrCreate`'s connect branch
 * enforce access only. Remaining pass-through kinds (`disconnect`, `set`,
 * `updateMany`, `deleteMany`) return their value unchanged so Prisma's own
 * constraints apply — they are intentionally NOT in scope for #569.
 */
const nestedOpRegistry: Record<string, NestedOpHandler> = {
  create: {
    needsInclude: true,
    execute: ({
      value,
      fieldName,
      relatedListName,
      relatedListConfig,
      context,
      config,
      prisma,
      afterTasks,
      excludeIds,
    }) =>
      processNestedCreate(
        value as Record<string, unknown> | Array<Record<string, unknown>>,
        fieldName,
        relatedListName,
        relatedListConfig,
        context,
        config,
        prisma,
        afterTasks,
        excludeIds,
      ),
  },
  connect: {
    needsInclude: false,
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
    needsInclude: true,
    execute: ({
      value,
      fieldName,
      relatedListName,
      relatedListConfig,
      context,
      config,
      prisma,
      afterTasks,
      excludeIds,
    }) =>
      processNestedConnectOrCreate(
        value as Record<string, unknown> | Array<Record<string, unknown>>,
        fieldName,
        relatedListName,
        relatedListConfig,
        context,
        config,
        prisma,
        afterTasks,
        excludeIds,
      ),
  },
  update: {
    needsInclude: true,
    execute: ({
      value,
      fieldName,
      relatedListName,
      relatedListConfig,
      context,
      config,
      prisma,
      afterTasks,
      excludeIds,
    }) =>
      processNestedUpdate(
        value as Record<string, unknown> | Array<Record<string, unknown>>,
        fieldName,
        relatedListName,
        relatedListConfig,
        context,
        config,
        prisma,
        afterTasks,
        excludeIds,
      ),
  },
  delete: {
    // The row no longer exists after the parent write, so no read-back include.
    needsInclude: false,
    execute: ({ value, relatedListName, relatedListConfig, context, prisma, afterTasks }) =>
      processNestedDelete(
        value as Record<string, unknown> | Array<Record<string, unknown>> | boolean,
        relatedListName,
        relatedListConfig,
        context,
        prisma,
        afterTasks,
      ),
  },
  // Pass-through kinds: no hooks/access control, left to Prisma's own constraints.
  // (Out of scope for #569 — see the issue's "Out of scope" notes.)
  disconnect: { needsInclude: false, execute: ({ value }) => Promise.resolve(value) },
  deleteMany: { needsInclude: false, execute: ({ value }) => Promise.resolve(value) },
  set: { needsInclude: false, execute: ({ value }) => Promise.resolve(value) },
  updateMany: { needsInclude: false, execute: ({ value }) => Promise.resolve(value) },
}

/**
 * Order in which nested-op kinds are processed for a single relationship field.
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
  fieldName: string,
  valueRecord: Record<string, unknown>,
  args: Omit<NestedOpHandlerArgs, 'value' | 'fieldName'>,
  includeFields: Set<string>,
): Promise<Record<string, unknown>> {
  const nestedOp: Record<string, unknown> = {}

  for (const kind of nestedOpOrder) {
    const value = valueRecord[kind]
    if (value === undefined) {
      continue
    }

    const handler = nestedOpRegistry[kind]
    if (handler.needsInclude) {
      includeFields.add(fieldName)
    }
    nestedOp[kind] = await handler.execute({
      ...args,
      value,
      fieldName,
    })
  }

  return nestedOp
}

/**
 * Process all nested operations in a data payload.
 *
 * Recursively handles relationship fields with nested writes. In addition to
 * transforming the payload it runs each nested record's `beforeOperation` and
 * collects deferred `afterOperation` tasks (run by the Write Pipeline after the
 * parent persist via {@link runAfterTasks}). See ADR-0010.
 */
export async function processNestedOperations(
  data: Record<string, unknown>,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  context: AccessContext & { prisma: unknown },
  operation: 'create' | 'update',
  depth: number = 0,
): Promise<NestedOpsResult> {
  const MAX_DEPTH = 5

  const afterTasks: AfterTask[] = []
  const includeFields = new Set<string>()

  if (depth >= MAX_DEPTH) {
    return { data, afterTasks, includeFields }
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
    // Sanity: ensure the resolved list name matches the config identity.
    const resolvedListName = relatedListName || findListName(relatedListConfig, config)

    processed[fieldName] = await processFieldNestedOps(
      fieldName,
      value as Record<string, unknown>,
      {
        relatedListName: resolvedListName,
        relatedListConfig,
        context,
        config,
        prisma: context.prisma,
        afterTasks,
        excludeIds: new Set<string>(),
      },
      includeFields,
    )
  }

  return { data: processed, afterTasks, includeFields }
}

/**
 * Run a set of deferred nested `afterOperation` tasks against a persisted parent
 * row. Tasks run sequentially so a throwing after-hook aborts the rest (and, run
 * inside the transaction by the Write Pipeline, rolls the whole write back).
 */
export async function runAfterTasks(
  afterTasks: AfterTask[],
  parentResult: Record<string, unknown>,
): Promise<void> {
  for (const task of afterTasks) {
    await task.run(parentResult)
  }
}
