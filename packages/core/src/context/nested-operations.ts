import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'
import { ormModel } from '../access/orm-client.js'
import type { OrmClient } from '../access/types.js'
import type { AccessContext, FieldAccess, PrismaFilter } from '../access/types.js'
import {
  checkAccess,
  checkCreateAccess,
  filterWritableFields,
  getRelatedListConfig,
  mergeFilters,
  resolveSyntheticReverseRelation,
} from '../access/index.js'
import { checkFieldAccess } from '../access/field-access.js'
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
  splitMultiColumnFields,
  ValidationError,
} from '../hooks/index.js'
import { getDbKey } from '../lib/case-utils.js'
import { applyCreateDefaults } from './apply-defaults.js'

/**
 * Nested writes (#569 / ADR-0010): give nested `create`/`update`/`delete` the
 * same before/afterOperation hooks as an equivalent top-level write, inside
 * the one transaction the Write Pipeline opens. `processNestedOperations`
 * transforms the payload and runs `beforeOperation`, returning deferred
 * {@link AfterTask}s that {@link runAfterTasks} runs once the parent has
 * persisted. See ADR-0010 for the full mechanism.
 */

/** A deferred nested `afterOperation` task, run once the parent has persisted. */
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

function isRelationshipField(fieldConfig: FieldConfig | undefined): boolean {
  return fieldConfig?.type === 'relationship'
}

/** Resolve a list name by matching config object identity, not by name. */
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
 * Read the rows of a parent's included relation as an array.
 *
 * A to-one relation comes back as a single row (or `null`); a to-many relation
 * comes back as an array. Normalises both so callers can apply a uniform id-diff.
 */
function includedRows(
  parentResult: Record<string, unknown>,
  fieldName: string,
): Array<Record<string, unknown>> {
  const included = parentResult[fieldName]
  if (included == null) return []
  if (Array.isArray(included)) return included as Array<Record<string, unknown>>
  return [included as Record<string, unknown>]
}

/**
 * Recover an UPDATED nested row from the parent result by its known id.
 *
 * The updated row's id is known up front (it was fetched for access as
 * `originalItem`), so the persisted row is the included row with that id.
 */
function recoverUpdatedRow(
  parentResult: Record<string, unknown>,
  fieldName: string,
  knownId: string | undefined,
): Record<string, unknown> | undefined {
  if (knownId === undefined) return undefined
  return includedRows(parentResult, fieldName).find((r) => r.id === knownId)
}

/**
 * Recover the CREATED nested rows from the parent result by id-diff: the
 * included rows whose ids are NOT in `preExistingIds`. Returned in include
 * order, which {@link CreatedRowRecovery} pairs to create-payload entries by
 * position — reordering this would break that pairing.
 */
function recoverCreatedRows(
  parentResult: Record<string, unknown>,
  fieldName: string,
  preExistingIds: Set<string>,
): Array<Record<string, unknown>> {
  return includedRows(parentResult, fieldName).filter(
    (r) => typeof r.id === 'string' && !preExistingIds.has(r.id as string),
  )
}

/**
 * Shared, memoised recovery of the rows created for ONE nested `create` payload
 * on ONE relation field, by id-diff against the parent's pre-persist related
 * ids, paired to create-payload entries by position. See ADR-0010. The id-diff
 * is cached per parent result so every entry's task shares it.
 *
 * `inputData`↔row pairing is positional and best-effort; `item` correctness
 * (each task gets a genuinely-created, distinct row) is guaranteed — a
 * pre-existing row can never be returned because the diff excludes it.
 */
interface CreatedRowRecovery {
  /** Recover the created row for the create-payload entry at `index`. */
  rowAt(parentResult: Record<string, unknown>, index: number): Record<string, unknown> | undefined
}

function createCreatedRowRecovery(
  fieldName: string,
  preExistingIds: Set<string>,
): CreatedRowRecovery {
  let cache: { source: Record<string, unknown>; rows: Array<Record<string, unknown>> } | undefined
  return {
    rowAt(parentResult, index) {
      if (!cache || cache.source !== parentResult) {
        cache = {
          source: parentResult,
          rows: recoverCreatedRows(parentResult, fieldName, preExistingIds),
        }
      }
      return cache.rows[index]
    },
  }
}

/**
 * Capture the ids of the rows currently linked to the parent via `fieldName`,
 * BEFORE the parent persists, so created rows can later be identified by id-diff.
 * Empty for a parent CREATE (no parent row exists yet to have related rows).
 *
 * `prisma` must be the transaction client — the read has to participate in the
 * transaction to see a consistent snapshot.
 */
async function capturePreExistingIds(
  parentListName: string,
  parentOriginalItem: Record<string, unknown> | undefined,
  fieldName: string,
  prisma: OrmClient,
): Promise<Set<string>> {
  const ids = new Set<string>()
  const parentId = parentOriginalItem?.id
  if (typeof parentId !== 'string') {
    // Parent create (no existing row) — nothing pre-exists.
    return ids
  }

  // Access Prisma model dynamically - required because model names are generated at runtime
  const parentModel = ormModel(prisma, parentListName)
  if (!parentModel?.findUnique) return ids

  const current = await parentModel.findUnique({
    where: { id: parentId },
    include: { [fieldName]: true },
  })
  for (const row of includedRows((current ?? {}) as Record<string, unknown>, fieldName)) {
    if (typeof row.id === 'string') ids.add(row.id)
  }
  return ids
}

/**
 * Process nested create operations: run the target list's full input pipeline
 * and `beforeOperation`, then register an `afterOperation` task keyed to the
 * parent's included relation.
 */
async function processNestedCreate(
  items: Record<string, unknown> | Array<Record<string, unknown>>,
  fieldName: string,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  config: OpenSaasConfig,
  prisma: OrmClient,
  afterTasks: AfterTask[],
  recovery: CreatedRowRecovery,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const itemsArray = Array.isArray(items) ? items : [items]

  const processedItems = await Promise.all(
    itemsArray.map(async (item, index) => {
      if (!context._isSudo) {
        const createAccess = relatedListConfig.access?.operation?.create
        const allowed = await checkCreateAccess(relatedListName, createAccess, {
          session: context.session,
          context,
        })

        if (!allowed) {
          throw new Error('Access denied: Cannot create related item')
        }
      }

      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'create',
        inputData: item,
        resolvedData: item,
        item: undefined,
        context,
      })

      resolvedData = await executeFieldResolveInputHooks(
        item,
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
        relatedListName,
      )

      // Apply field defaults to omitted inputs (resolve-then-validate, #615) so
      // a nested required-with-default field resolves before `isRequired` runs,
      // mirroring the top-level pipeline. Create-only.
      resolvedData = applyCreateDefaults(resolvedData, relatedListConfig.fields)

      await executeValidate(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'create',
        inputData: item,
        resolvedData,
        item: undefined,
        context,
      })

      await executeFieldValidateHooks(
        item,
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
        relatedListName,
      )

      const validation = validateFieldRules(resolvedData, relatedListConfig.fields, 'create')
      if (validation.errors.length > 0) {
        throw new ValidationError(validation.errors, validation.fieldErrors)
      }

      // Split multi-column fields into physical columns (#789) — must run after
      // validation, which operates on the logical (pre-split) value.
      resolvedData = await splitMultiColumnFields(
        item,
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
      )

      const filtered = await filterWritableFields(
        resolvedData,
        relatedListConfig.fields,
        'create',
        {
          session: context.session,
          context,
          inputData: item,
          listName: relatedListName,
          config,
        },
      )

      // This nested row is itself being created, so it has no pre-existing
      // related rows of its own (parent originalItem is undefined below).
      const { data: nestedData, afterTasks: childAfterTasks } = await processNestedOperations(
        filtered,
        relatedListConfig.fields,
        config,
        { ...context, prisma },
        'create',
        relatedListName,
        undefined,
        // Its own create payload is the enclosing inputData for the connect-site
        // owning-field gate (#588).
        item,
      )

      await executeFieldBeforeOperationHooks(
        item,
        resolvedData,
        relatedListConfig.fields,
        'create',
        context,
        relatedListName,
      )

      await executeBeforeOperation(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'create',
        inputData: item,
        resolvedData,
        context,
      })

      // Fires once the parent has persisted. The row is recovered by id-diff and
      // paired to THIS entry by position (see CreatedRowRecovery), so a to-many
      // `create: [{A},{B}]` fires once per row against its own distinct row.
      afterTasks.push({
        fieldName,
        run: async (parentResult) => {
          const createdItem = recovery.rowAt(parentResult, index)
          if (!createdItem) {
            // Could not identify the created row by id-diff — the parent write
            // didn't echo this nested relation (e.g. a client/mock that doesn't
            // honour `include`; real Prisma always does). Deliberately SKIP this
            // record's `afterOperation` rather than fabricate an id-less item —
            // `item` correctness is the must-have, so a missing row is never faked.
            return
          }

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
 * Connecting references an existing row rather than modifying it, so — mirroring
 * Keystone — it requires **read/query** access on the target (#578), not update.
 * A filter-result query access is evaluated in the DATABASE via
 * `findFirst({ where: { AND: [connection, accessFilter] } })` rather than in
 * memory, so it correctly handles arbitrary nested-relation predicates and
 * boolean combinators; a non-existent id is folded into the same check.
 *
 * In ADDITION, the OWNING relationship field's field-level access (e.g.
 * `Post.author`'s `create`/`update` access) must permit the connect (#588) —
 * the other half Keystone requires: read access on the target AND write access
 * on the owning field. A deny here denies the connect even when the target row
 * is readable/reachable.
 *
 * Sudo bypasses the entire check (handled by the caller).
 */
async function verifyConnectReachable(
  connection: Record<string, unknown>,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  prisma: OrmClient,
  owningFieldAccess: FieldAccess | undefined,
  enclosingOperation: 'create' | 'update',
  enclosingItem: Record<string, unknown> | undefined,
  enclosingInputData: Record<string, unknown> | undefined,
): Promise<void> {
  // Access Prisma model dynamically - required because model names are generated at runtime
  const model = ormModel(prisma, relatedListName)

  // #588 owning-field gate (see docblock above). `item`/`inputData` are the
  // ENCLOSING write's `originalItem`/`inputData` — the same values the canonical
  // Phase-5 `filterWritableFields` call passes for this field — so an
  // item-/inputData-dependent field-access rule can't diverge between the two gates.
  const owningFieldAllowed = await checkFieldAccess(owningFieldAccess, enclosingOperation, {
    session: context.session,
    item: enclosingItem,
    inputData: enclosingInputData,
    context,
  })
  if (!owningFieldAllowed) {
    throw new Error('Access denied: Cannot connect to this item')
  }

  const queryAccess = relatedListConfig.access?.operation?.query
  const accessResult = await checkAccess(queryAccess, {
    session: context.session,
    context,
  })

  if (accessResult === false) {
    throw new Error('Access denied: Cannot connect to this item')
  }

  // Full access still verifies the row exists, to keep "Item not found" behaviour.
  if (accessResult === true) {
    const item = await model.findUnique({ where: connection })
    if (!item) {
      throw new Error(`Cannot connect: Item not found`)
    }
    return
  }

  // Filter result: reachable iff AND-combining the connection with the filter
  // returns a row (see docblock above).
  const reachable = await model.findFirst({
    where: { AND: [connection, accessResult] },
  })

  if (!reachable) {
    throw new Error('Access denied: Cannot connect to this item')
  }
}

/**
 * Process nested connect operations.
 * Verifies read (query) access to the items being connected via DB reachability
 * AND the owning relationship field's field-level access (#588).
 */
async function processNestedConnect(
  connections: Record<string, unknown> | Array<Record<string, unknown>>,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  prisma: OrmClient,
  owningFieldAccess: FieldAccess | undefined,
  enclosingOperation: 'create' | 'update',
  enclosingItem: Record<string, unknown> | undefined,
  enclosingInputData: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const connectionsArray = Array.isArray(connections) ? connections : [connections]

  if (!context._isSudo) {
    for (const connection of connectionsArray) {
      await verifyConnectReachable(
        connection,
        relatedListName,
        relatedListConfig,
        context,
        prisma,
        owningFieldAccess,
        enclosingOperation,
        enclosingItem,
        enclosingInputData,
      )
    }
  }

  return connections
}

/**
 * Re-check a nested update/delete access result against the target row,
 * mirroring the Write Pipeline's `resolveExistingTarget` (#1081): `false`
 * denies, `true` allows outright (the row's existence is already established
 * by the caller's own `findUnique`), and a returned PrismaFilter must
 * additionally match the row, re-checked in the DATABASE via
 * `findFirst(mergeFilters(where, accessResult))` rather than in memory — the
 * same requirement `connect`'s reachability check already applies (#578), so
 * nested-relation predicates and boolean combinators are honoured correctly.
 */
async function isExistingTargetAccessible(
  model: { findFirst: (args: { where: Record<string, unknown> }) => Promise<unknown> },
  where: Record<string, unknown>,
  accessResult: boolean | PrismaFilter,
): Promise<boolean> {
  if (accessResult === false) return false
  if (accessResult === true) return true

  const matchesFilter = await model.findFirst({ where: mergeFilters(where, accessResult) ?? {} })
  return matchesFilter !== null
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
  prisma: OrmClient,
  afterTasks: AfterTask[],
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const updatesArray = Array.isArray(updates) ? updates : [updates]

  const processedUpdates = await Promise.all(
    updatesArray.map(async (update) => {
      // Access Prisma model dynamically - required because model names are generated at runtime
      const model = ormModel(prisma, relatedListName)

      const where = (update as Record<string, unknown>).where as Record<string, unknown>

      // Fetched here and reused as `originalItem` for afterOperation.
      const originalItem = await model.findUnique({ where })

      if (!originalItem) {
        throw new Error('Cannot update: Item not found')
      }

      const knownId = typeof originalItem.id === 'string' ? (originalItem.id as string) : undefined

      if (!context._isSudo) {
        const updateAccess = relatedListConfig.access?.operation?.update
        const accessResult = await checkAccess(updateAccess, {
          session: context.session,
          item: originalItem,
          context,
        })

        if (!(await isExistingTargetAccessible(model, where, accessResult))) {
          throw new Error('Access denied: Cannot update related item')
        }
      }

      const updateData = (update as Record<string, unknown>).data as Record<string, unknown>
      let resolvedData = await executeResolveInput(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'update',
        inputData: updateData,
        resolvedData: updateData,
        item: originalItem,
        context,
      })

      resolvedData = await executeFieldResolveInputHooks(
        updateData,
        resolvedData,
        relatedListConfig.fields,
        'update',
        context,
        relatedListName,
        originalItem,
      )

      await executeValidate(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'update',
        inputData: updateData,
        resolvedData,
        item: originalItem,
        context,
      })

      await executeFieldValidateHooks(
        updateData,
        resolvedData,
        relatedListConfig.fields,
        'update',
        context,
        relatedListName,
        originalItem,
      )

      const validation = validateFieldRules(resolvedData, relatedListConfig.fields, 'update')
      if (validation.errors.length > 0) {
        throw new ValidationError(validation.errors, validation.fieldErrors)
      }

      // Split multi-column fields into physical columns (#789) — must run after
      // validation, which operates on the logical (pre-split) value.
      resolvedData = await splitMultiColumnFields(
        updateData,
        resolvedData,
        relatedListConfig.fields,
        'update',
        context,
        originalItem,
      )

      const filtered = await filterWritableFields(
        resolvedData,
        relatedListConfig.fields,
        'update',
        {
          session: context.session,
          item: originalItem,
          context,
          inputData: updateData,
          listName: relatedListName,
          config,
        },
      )

      // This nested row is being updated, so its own relations' pre-existing
      // rows are captured from `originalItem` below.
      const { data: nestedData, afterTasks: childAfterTasks } = await processNestedOperations(
        filtered,
        relatedListConfig.fields,
        config,
        { ...context, prisma },
        'update',
        relatedListName,
        originalItem,
        // Its own update payload is the enclosing inputData for the connect-site
        // owning-field gate (#588).
        updateData,
      )

      await executeFieldBeforeOperationHooks(
        updateData,
        resolvedData,
        relatedListConfig.fields,
        'update',
        context,
        relatedListName,
        originalItem,
      )

      await executeBeforeOperation(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'update',
        inputData: updateData,
        item: originalItem,
        resolvedData,
        context,
      })

      // Fires after the parent persist; the row is recovered by its known id.
      afterTasks.push({
        fieldName,
        run: async (parentResult) => {
          const persisted = recoverUpdatedRow(parentResult, fieldName, knownId)
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
  prisma: OrmClient,
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
      const model = ormModel(prisma, relatedListName)

      // A nested delete entry is itself the unique `where` (e.g. `{ id }`).
      const where = del as Record<string, unknown>

      const originalItem = await model.findUnique({ where })
      if (!originalItem) {
        throw new Error('Cannot delete: Item not found')
      }

      if (!context._isSudo) {
        const deleteAccess = relatedListConfig.access?.operation?.delete
        const accessResult = await checkAccess(deleteAccess, {
          session: context.session,
          item: originalItem,
          context,
        })

        if (!(await isExistingTargetAccessible(model, where, accessResult))) {
          throw new Error('Access denied: Cannot delete related item')
        }
      }

      await executeValidate(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'delete',
        item: originalItem,
        context,
      })

      await executeFieldValidateHooks(
        undefined,
        undefined,
        relatedListConfig.fields,
        'delete',
        context,
        relatedListName,
        originalItem,
      )

      await executeFieldBeforeOperationHooks(
        {},
        {},
        relatedListConfig.fields,
        'delete',
        context,
        relatedListName,
        originalItem,
      )

      await executeBeforeOperation(relatedListConfig.hooks, {
        listKey: relatedListName,
        operation: 'delete',
        item: originalItem,
        context,
      })

      // The row is gone after persist, so originalItem is the authoritative
      // record passed to the after-hooks below.
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

async function processNestedConnectOrCreate(
  operations: Record<string, unknown> | Array<Record<string, unknown>>,
  fieldName: string,
  relatedListName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  relatedListConfig: ListConfig<any>,
  context: AccessContext,
  config: OpenSaasConfig,
  prisma: OrmClient,
  afterTasks: AfterTask[],
  recovery: CreatedRowRecovery,
  owningFieldAccess: FieldAccess | undefined,
  enclosingOperation: 'create' | 'update',
  enclosingItem: Record<string, unknown> | undefined,
  enclosingInputData: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | Array<Record<string, unknown>>> {
  const operationsArray = Array.isArray(operations) ? operations : [operations]

  const processedOps = await Promise.all(
    operationsArray.map(async (op) => {
      const opRecord = op as Record<string, unknown>

      // When the target row exists, connectOrCreate applies the same connect
      // semantics as processNestedConnect (read access + #588 owning-field gate,
      // both evaluated via DB reachability); otherwise it falls through to
      // create. An access-denied error must NOT be swallowed into that fallback
      // — only a genuine "row absent" may fall back to create.
      let rowExists = false
      if (!context._isSudo) {
        const model = ormModel(prisma, relatedListName)
        const where = opRecord.where as Record<string, unknown>

        const existingItem = await model.findUnique({ where })

        if (existingItem) {
          rowExists = true

          const owningFieldAllowed = await checkFieldAccess(owningFieldAccess, enclosingOperation, {
            session: context.session,
            item: enclosingItem,
            inputData: enclosingInputData,
            context,
          })
          if (!owningFieldAllowed) {
            throw new Error('Access denied: Cannot connect to existing item')
          }

          const queryAccess = relatedListConfig.access?.operation?.query
          const accessResult = await checkAccess(queryAccess, {
            session: context.session,
            item: existingItem,
            context,
          })

          if (accessResult === false) {
            throw new Error('Access denied: Cannot connect to existing item')
          }

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

      // Only register an afterOperation task when the create branch will
      // actually run (row absent), so a pure connect doesn't fire create hooks.
      // Under sudo we can't tell statically, so the create pipeline always runs
      // its hooks there (sudo bypasses access only, not hooks).
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
        recovery,
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
  /**
   * Field-level `access` of the OWNING relationship field (e.g. `Post.author`).
   * Gates connect/connectOrCreate by the owning field's create/update access —
   * see the #588 gate in {@link verifyConnectReachable}.
   */
  owningFieldAccess: FieldAccess | undefined
  /** The enclosing write's operation, used as the owning-field gate's field-access operation. */
  enclosingOperation: 'create' | 'update'
  /**
   * The enclosing write's `originalItem` (`undefined` for an enclosing create).
   * Passed to the owning-field gate so it matches the canonical Phase-5
   * `filterWritableFields` call and the two can't diverge (#588).
   */
  enclosingItem: Record<string, unknown> | undefined
  /** The enclosing write's input data, passed to the owning-field gate for the same reason as `enclosingItem`. */
  enclosingInputData: Record<string, unknown> | undefined
  context: AccessContext
  config: OpenSaasConfig
  /** Prisma client used for dynamic model access during access checks. */
  prisma: OrmClient
  /** Collector for deferred nested `afterOperation` tasks. */
  afterTasks: AfterTask[]
  /**
   * Recovery of the rows created on THIS field by id-diff (created kinds only —
   * `create` and `connectOrCreate`'s create branch). Identifies each created row
   * by excluding the ids that existed before the persist, and pairs them to the
   * create-payload entries by position. Created lazily because it requires a
   * pre-persist DB read; `undefined` for kinds that never create.
   */
  recovery: CreatedRowRecovery | undefined
}

/**
 * Narrow the lazily-built {@link CreatedRowRecovery} to a present value for the
 * created kinds (`create`, `connectOrCreate`). It is always provided for these
 * kinds by {@link processFieldNestedOps}; the guard backstops a programming
 * error rather than a user-facing path.
 */
function requireRecovery(
  recovery: CreatedRowRecovery | undefined,
  kind: string,
): CreatedRowRecovery {
  if (!recovery) {
    throw new Error(`Internal error: missing created-row recovery for nested "${kind}"`)
  }
  return recovery
}

/** Nested-op kinds that can create new rows and so need created-row recovery. */
const CREATING_KINDS = new Set(['create', 'connectOrCreate'])

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
      recovery,
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
        requireRecovery(recovery, 'create'),
      ),
  },
  connect: {
    needsInclude: false,
    execute: ({
      value,
      relatedListName,
      relatedListConfig,
      context,
      prisma,
      owningFieldAccess,
      enclosingOperation,
      enclosingItem,
      enclosingInputData,
    }) =>
      processNestedConnect(
        value as Record<string, unknown> | Array<Record<string, unknown>>,
        relatedListName,
        relatedListConfig,
        context,
        prisma,
        owningFieldAccess,
        enclosingOperation,
        enclosingItem,
        enclosingInputData,
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
      recovery,
      owningFieldAccess,
      enclosingOperation,
      enclosingItem,
      enclosingInputData,
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
        requireRecovery(recovery, 'connectOrCreate'),
        owningFieldAccess,
        enclosingOperation,
        enclosingItem,
        enclosingInputData,
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
  args: Omit<NestedOpHandlerArgs, 'value' | 'fieldName' | 'recovery'>,
  includeFields: Set<string>,
  parentListName: string,
  parentOriginalItem: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const nestedOp: Record<string, unknown> = {}

  // Created-row recovery is only needed when this field has a creating kind
  // (`create`/`connectOrCreate`). When present it requires a pre-persist read of
  // the parent's current related ids, so build it once, lazily, and share it
  // across the creating kinds on this field.
  let recovery: CreatedRowRecovery | undefined
  const hasCreatingKind = nestedOpOrder.some(
    (kind) => CREATING_KINDS.has(kind) && valueRecord[kind] !== undefined,
  )
  if (hasCreatingKind) {
    const preExistingIds = await capturePreExistingIds(
      parentListName,
      parentOriginalItem,
      fieldName,
      args.prisma,
    )
    recovery = createCreatedRowRecovery(fieldName, preExistingIds)
  }

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
      recovery,
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
  parentListName: string,
  parentOriginalItem: Record<string, unknown> | undefined,
  // The enclosing write's inputData, for the #588 owning-field gate (see
  // verifyConnectReachable). `undefined` is tolerated (defaults to `{}`).
  parentInputData: Record<string, unknown> | undefined = undefined,
): Promise<NestedOpsResult> {
  const afterTasks: AfterTask[] = []
  const includeFields = new Set<string>()

  const processed: Record<string, unknown> = {}

  for (const [fieldName, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      processed[fieldName] = value
      continue
    }

    const fieldConfig = fieldConfigs[fieldName]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
    let relatedListConfig: ListConfig<any>
    let resolvedListName: string
    let owningFieldAccess: FieldAccess | undefined

    if (isRelationshipField(fieldConfig)) {
      const relationshipField = fieldConfig as { type: 'relationship'; ref: string }
      const relatedConfig = getRelatedListConfig(relationshipField.ref, config)
      if (!relatedConfig) {
        processed[fieldName] = value
        continue
      }

      const { listName: relatedListName, listConfig } = relatedConfig
      resolvedListName = relatedListName || findListName(listConfig, config)
      relatedListConfig = listConfig
      // The owning relationship field's field-level access, for the #588 gate
      // in verifyConnectReachable.
      owningFieldAccess = fieldConfig.access
    } else if (!fieldConfig) {
      // Not a field the parent's config declares — check whether it names the
      // synthetic back-relation a list-only `ref` generates on this list
      // (`from_<List>_<field>`, #978). Resolved, it is processed exactly like a
      // nested write through the declared field that owns it; unresolved, it
      // is left untouched. This is NOT solely a sudo path: a multi-column
      // field's raw per-part columns (e.g. `m_url`/`m_size`, #789) are ALSO
      // undeclared from this list's `fieldConfigs` perspective and reach here
      // on every write, sudo or not — `filterWritableFields` already
      // recognises and gates those via its own `splitColumnOwners` map before
      // its undeclared-key branch, and this function has no such map to tell
      // them apart from a genuinely-unrecognised key, so it must not throw
      // here. A genuinely unrecognised key under sudo is refused instead by
      // `filterWritableFields`'s own resolution attempt, one level up.
      const synthetic = resolveSyntheticReverseRelation(fieldName, parentListName, config)
      if (!synthetic) {
        processed[fieldName] = value
        continue
      }

      resolvedListName = synthetic.sourceListName
      relatedListConfig = synthetic.sourceListConfig
      // There is no parent-side field here (unlike the declared-relationship
      // branch above) — the FK-owning field genuinely IS the one the source
      // list declares, so its access is the owning-field gate.
      owningFieldAccess = synthetic.sourceFieldConfig.access
    } else {
      processed[fieldName] = value
      continue
    }

    processed[fieldName] = await processFieldNestedOps(
      fieldName,
      value as Record<string, unknown>,
      {
        relatedListName: resolvedListName,
        relatedListConfig,
        owningFieldAccess,
        enclosingOperation: operation,
        // Same values Phase-5 `filterWritableFields` passes for this field, so
        // the #588 owning-field gate can't diverge from it.
        enclosingItem: parentOriginalItem,
        enclosingInputData: parentInputData ?? {},
        context,
        config,
        prisma: context.prisma,
        afterTasks,
      },
      includeFields,
      parentListName,
      parentOriginalItem,
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
