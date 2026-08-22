import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import type { AccessContext, PrismaClientLike } from '../access/types.js'
import {
  checkAccess,
  mergeFilters,
  filterReadableFields,
  filterWritableFields,
} from '../access/index.js'
import {
  executeValidate,
  executeBeforeOperation,
  executeAfterOperation,
  executeFieldValidateHooks,
  executeFieldBeforeOperationHooks,
  executeFieldAfterOperationHooks,
  ValidationError,
} from '../hooks/index.js'
import { hookPipeline } from './hook-pipeline.js'
import { processNestedOperations, runAfterTasks } from './nested-operations.js'
import type { AfterTask } from './nested-operations.js'
import { enumerateInvolvedLists, runWithTransactionBoundary } from './transaction-boundary.js'
import { TransactionRegistry } from '../access/transaction-registry.js'
import { getDbKey } from '../lib/case-utils.js'
// NOTE: `index.ts` imports from this module too — this is an intentional cyclic
// dependency. It is safe because `buildDbDelegate` is only INVOKED at write
// time (never during module evaluation), so by the time it runs the export is
// fully initialised.
import { buildDbDelegate } from './index.js'

/**
 * Write Pipeline — runs the canonical, secured write sequence for one
 * create/update/delete; see the "Write Pipeline" glossary entry in CONTEXT.md
 * for the phase order and the hooks ordering in CLAUDE.md. Reads are out of
 * scope (ADR-0001).
 */

export type WriteOperation = 'create' | 'update' | 'delete'

/**
 * Result of resolving a write target (axis 1). `denied` covers access denial,
 * a missing target, or a filter non-match alike, and short-circuits to `null`
 * before any hooks or the DB call.
 */
export type TargetResolution =
  { status: 'ok'; originalItem: Record<string, unknown> | undefined } | { status: 'denied' }

/**
 * Minimal dynamic Prisma model surface used by the write pipeline. Model names
 * are generated at runtime, so the concrete client type is not known here.
 */
export interface PrismaModel {
  findUnique: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>
  findFirst: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown> | null>
  count: () => Promise<number>
  create: (args: {
    data: Record<string, unknown>
    include?: Record<string, unknown>
  }) => Promise<Record<string, unknown>>
  update: (args: {
    where: Record<string, unknown>
    data: Record<string, unknown>
    include?: Record<string, unknown>
  }) => Promise<Record<string, unknown>>
  delete: (args: { where: Record<string, unknown> }) => Promise<Record<string, unknown>>
}

/**
 * Per-operation strategy. Supplies the three axes on which create/update/delete
 * differ; the pipeline owns the shared phase order around them.
 */
export interface WriteStrategy {
  operation: WriteOperation

  /**
   * Axis 1: resolve the target row and check operation-level access.
   * Implementations must honour `context._isSudo`.
   */
  resolveTarget(model: PrismaModel): Promise<TargetResolution>

  /**
   * Axis 2: whether to run the input-shaping phases (resolveInput → validate
   * hooks → built-in field rules → filter-writable → nested ops). Delete runs
   * only its `validate`/field-validate hooks and skips the rest.
   */
  runInputPhases: boolean

  /**
   * Axis 3: execute the database write and return the persisted/deleted row.
   * `data` is the fully-resolved write payload (empty object for delete).
   * `include` (create/update) asks the DB to return nested relations so nested
   * `afterOperation` can recover its persisted `item`; delete ignores it.
   */
  persist(
    model: PrismaModel,
    data: Record<string, unknown>,
    include?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
}

/**
 * Resolve the dynamic Prisma model for a list. Model names are generated at
 * runtime, so the cast is unavoidable — kept localized here (mirrors
 * `context/index.ts`).
 */
function getModel<TPrisma extends PrismaClientLike>(
  prisma: TPrisma,
  listName: string,
): PrismaModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- model names are generated at runtime
  return (prisma as any)[getDbKey(listName)] as PrismaModel
}

/**
 * Minimal shape of a Prisma interactive-transaction-capable client. `tx` is
 * dynamically typed like the model surface above (names generated at runtime).
 */
interface TransactionCapable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- $transaction callback receives a dynamically-typed tx client
  $transaction?: (fn: (tx: any) => Promise<unknown>) => Promise<unknown>
}

/**
 * Run `fn` inside ONE interactive transaction, used as the persistence target
 * for the parent and all nested writes (ADR-0010).
 *
 * Without `$transaction` (e.g. a test mock), `fn` runs directly against the
 * client — hook ordering and arguments are identical, but only a real
 * transaction provides the rollback guarantee.
 */
async function runInTransaction<TPrisma extends PrismaClientLike>(
  prisma: TPrisma,
  fn: (tx: TPrisma) => Promise<Record<string, unknown> | null>,
): Promise<Record<string, unknown> | null> {
  const client = prisma as unknown as TransactionCapable
  if (typeof client.$transaction === 'function') {
    return (await client.$transaction(async (tx) => fn(tx as TPrisma))) as Record<
      string,
      unknown
    > | null
  }
  return fn(prisma)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function isSingletonList(listConfig: ListConfig<any>): boolean {
  return !!listConfig.isSingleton
}

export interface WritePipelineArgs<TPrisma extends PrismaClientLike> {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  prisma: TPrisma
  context: AccessContext<TPrisma>
  config: OpenSaasConfig
  /** The original input data for the write (create/update). `undefined` for delete. */
  inputData: Record<string, unknown> | undefined
  /** The per-operation strategy (see {@link WriteStrategy}). */
  strategy: WriteStrategy
  /**
   * The target resolution computed once before the transaction opens, and
   * reused inside it rather than resolved a second time — see the
   * pre-transaction gate in {@link runWritePipeline}.
   */
  preResolvedTarget?: TargetResolution
}

/**
 * Run the canonical secured write sequence once. Phase order matches the
 * "Write Pipeline" glossary entry in CONTEXT.md.
 *
 * Contract preserved exactly:
 *   - missing target / access denied / filter non-match → `null` (silent),
 *     BEFORE the DB call and BEFORE `beforeOperation`.
 *   - validation failure → THROW `ValidationError` (never silent).
 *   - sudo mode skips access checks and writable-field filtering.
 *   - `afterOperation` receives `originalItem` for update/delete (undefined for
 *     create).
 *   - delete returns the deleted row as-is (no Field Visibility pass).
 */
export async function runWritePipeline<TPrisma extends PrismaClientLike>(
  args: WritePipelineArgs<TPrisma>,
): Promise<Record<string, unknown> | null> {
  const { prisma, listName, listConfig, context, config, inputData, strategy } = args

  // ── Pre-transaction access gate (#590) ──────────────────────────────────────
  // Resolves the top-level target + access OUTSIDE the transaction so a denied
  // write short-circuits to `null` WITHOUT firing beforeTransaction/
  // afterTransaction — a denied write takes no external action, so the
  // boundary hooks must not run. The result feeds `preResolvedTarget` and is
  // REUSED inside the transaction rather than re-resolved, keeping the target
  // read exactly once (#569).
  const gate = await strategy.resolveTarget(getModel(prisma, listName))
  if (gate.status === 'denied') {
    return null
  }

  // ── Enumerate involved lists from the input tree (no DB reads) ──────────────
  const involvedLists = enumerateInvolvedLists({
    listName,
    listConfig,
    operation: strategy.operation,
    inputData,
    topLevelOriginalItem: gate.originalItem,
    config,
  })

  // ── Transaction ownership for the transaction-boundary hooks (ADR-0028) ────
  // A context carrying `_transactionOwner` is JOINING an enclosing transaction
  // it did not open — defer to that owner even if `prisma` here still exposes
  // `$transaction`. Otherwise this write becomes the owner: the registry every
  // joined write below it enqueues into.
  const existingOwner = context._transactionOwner
  const opensOwnTransaction =
    !existingOwner && typeof (prisma as TransactionCapable).$transaction === 'function'
  const ownedRegistry = opensOwnTransaction ? new TransactionRegistry() : undefined
  const transactionOwnerForBody = existingOwner ?? ownedRegistry

  // ── Bracket the transaction with beforeTransaction/afterTransaction (#590) ──
  // afterTransaction fires when the transaction settles, deferred to the owner
  // for a joined write (ADR-0028, symmetric-bracket rule).
  return runWithTransactionBoundary({
    involvedLists,
    context,
    joinedOwner: existingOwner,
    ownedRegistry,
    runTransaction: () =>
      // ADR-0010: parent + nested writes share `tx` as their persistence target.
      runInTransaction(prisma, (tx) =>
        runWriteInTransaction({
          ...args,
          prisma: tx,
          // Reuse the pre-transaction target resolution (#569 call-count semantics).
          preResolvedTarget: gate,
          // Rebind context.db/prisma to `tx` (ADR-0010 atomicity) and carry the
          // transaction owner (ADR-0028) — see bindContextToTransaction below.
          context: bindContextToTransaction(args, tx, transactionOwnerForBody),
        }),
      ),
  })
}

/**
 * Build an {@link AccessContext} whose `db`/`prisma` target the transaction
 * client `tx`, so a `context.db` write a hook performs runs inside — and rolls
 * back with — this write's transaction (ADR-0010).
 *
 * The access-controlled `db` delegates capture their Prisma client at
 * construction, so swapping `context.prisma` alone would not rebind `db` — we
 * rebuild the delegates against `tx` via {@link buildDbDelegate}, reusing the
 * request context's `session`, `storage`, `plugins`, `_isSudo`, and
 * `_resolveOutputChain` as-is (so a write from inside a `resolveOutput` hook
 * keeps that hook's chain). Plugin runtimes are NOT re-executed.
 *
 * `transactionOwner` (ADR-0028) is carried onto the rebuilt context so a hook's
 * own `context.db` write defers its transaction-boundary bracket to that owner
 * instead of firing eagerly.
 */
function bindContextToTransaction<TPrisma extends PrismaClientLike>(
  args: WritePipelineArgs<TPrisma>,
  tx: TPrisma,
  transactionOwner: TransactionRegistry | undefined,
): AccessContext<TPrisma> {
  const { context, config } = args
  const txContext: AccessContext<TPrisma> = {
    session: context.session,
    prisma: tx,
    db: context.db,
    storage: context.storage,
    plugins: context.plugins,
    _isSudo: context._isSudo,
    _resolveOutputChain: context._resolveOutputChain,
    _transactionOwner: transactionOwner,
  }
  // Rebuild `db` against `tx`, referencing `txContext` itself so hooks reached
  // through it see the transactional context.
  txContext.db = buildDbDelegate(config, tx, txContext)
  return txContext
}

/**
 * The body of one secured write, executed against the transaction client `tx`
 * (passed in as `args.prisma`). Returns `null` for the silent-failure cases and
 * the Field-Visibility-filtered row otherwise. Any throw here propagates out of
 * `runInTransaction` and rolls the transaction back.
 */
async function runWriteInTransaction<TPrisma extends PrismaClientLike>(
  args: WritePipelineArgs<TPrisma>,
): Promise<Record<string, unknown> | null> {
  const { listName, listConfig, prisma: tx, context, config, inputData, strategy } = args
  const { operation } = strategy
  const model = getModel(tx, listName)

  // ── Phase 1: resolve target + operation-level access ──────────────────────
  // Reuses `preResolvedTarget` from the pre-transaction gate rather than
  // reading the target twice; falls back to resolving here when invoked
  // directly (e.g. a unit test) without that bracket.
  const resolution = args.preResolvedTarget ?? (await strategy.resolveTarget(model))
  if (resolution.status === 'denied') {
    return null
  }
  const originalItem = resolution.originalItem

  // ── Delete path: skip input phases, run only validate/field-validate ────────
  if (!strategy.runInputPhases) {
    return runDeletePath({ listName, listConfig, context, originalItem, model, strategy })
  }

  // Only create/update reach here (delete short-circuited above); narrow so
  // field-hook helpers receive a 'create' | 'update' value.
  const writeOp: 'create' | 'update' = operation === 'create' ? 'create' : 'update'

  // `inputData` is always present here; `?? {}` is only a defensive fallback.
  const input = inputData ?? {}

  // ── Phases 2–4: transform + validate span (Hook Pipeline glossary, CONTEXT.md) ──
  // THROWS `ValidationError` on any validation failure (never silent).
  const { resolvedData } = await hookPipeline.run({
    operation: writeOp,
    listName,
    listConfig,
    inputData: input,
    item: originalItem,
    context,
  })

  // ── Phase 5: filter writable fields (field-level access, skip if sudo) ──────
  const filteredData = await filterWritableFields(resolvedData, listConfig.fields, writeOp, {
    session: context.session,
    item: originalItem,
    context: { ...context, _isSudo: context._isSudo },
    inputData: input,
    listName,
    config,
  })

  // ── Phase 5.5: process nested relationship operations ───────────────────────
  // Runs each nested record's resolveInput/validate/field-rules AND its
  // `beforeOperation` inside this transaction, returning deferred
  // `afterOperation` tasks plus the relation fields to `include` so those tasks
  // can recover their persisted `item`.
  const { data, afterTasks, includeFields } = await processNestedOperations(
    filteredData,
    listConfig.fields,
    config,
    { ...context, prisma: tx },
    writeOp,
    listName,
    originalItem,
    // Same `inputData` Phase 5's filterWritableFields used, so the connect-site
    // owning-field gate evaluates identically and can't diverge into a
    // spurious connect denial (#588).
    input,
  )

  // ── Phase 6: field-level beforeOperation (side effects only) ────────────────
  await executeFieldBeforeOperationHooks(
    input,
    resolvedData,
    listConfig.fields,
    writeOp,
    context,
    listName,
    originalItem,
  )

  // ── Phase 7: list-level beforeOperation ─────────────────────────────────────
  await executeBeforeOperation(
    listConfig.hooks,
    operation === 'create'
      ? {
          listKey: listName,
          operation: 'create',
          inputData: input,
          resolvedData,
          context,
        }
      : {
          listKey: listName,
          operation: 'update',
          inputData: input,
          item: originalItem,
          resolvedData,
          context,
        },
  )

  // ── Phase 8: DB write ───────────────────────────────────────────────────────
  // `include` returns the nested relations with deferred `afterOperation`
  // tasks so they can recover their persisted `item`.
  const include = buildIncludeFromFields(includeFields)
  const item = await strategy.persist(model, data, include)

  // ── Phase 9: list-level afterOperation ──────────────────────────────────────
  await executeAfterOperation(
    listConfig.hooks,
    operation === 'create'
      ? {
          listKey: listName,
          operation: 'create',
          inputData: input,
          item,
          resolvedData,
          context,
        }
      : {
          listKey: listName,
          operation: 'update',
          inputData: input,
          // Non-null for update (fetched in Phase 1); cast narrows the type.
          originalItem: originalItem as Record<string, unknown>,
          item,
          resolvedData,
          context,
        },
  )

  // ── Phase 10: field-level afterOperation (side effects only) ────────────────
  await executeFieldAfterOperationHooks(
    item,
    input,
    resolvedData,
    listConfig.fields,
    writeOp,
    context,
    listName,
    originalItem, // undefined for create, original row for update
  )

  // ── Phase 10.5: nested afterOperation (deferred, in this transaction) ────────
  // Each nested create/update/delete's `afterOperation` fires now, with the
  // persisted nested row recovered from the parent's included relations. A throw
  // here rolls the whole transaction back (parent write included).
  await runNestedAfterTasks(afterTasks, item)

  // ── Phase 11: Field Visibility (filter readable fields + resolveOutput) ─────
  return filterReadableFields(
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
}

/**
 * Build a Prisma `include` from the set of relation field names that have
 * deferred nested `afterOperation` tasks, so the parent write returns those
 * relations and the tasks can recover their persisted `item`.
 */
function buildIncludeFromFields(includeFields: Set<string>): Record<string, unknown> | undefined {
  if (includeFields.size === 0) return undefined
  const include: Record<string, unknown> = {}
  for (const field of includeFields) {
    include[field] = true
  }
  return include
}

/**
 * Run the deferred nested `afterOperation` tasks against the persisted parent
 * row (`?? {}` is only a type-narrowing guard — parent is always a record
 * here). Each task recovers its own nested row by id-diff/known id and THROWS
 * if it can't, rather than firing with a fabricated item (ADR-0010).
 */
async function runNestedAfterTasks(
  afterTasks: AfterTask[],
  item: Record<string, unknown>,
): Promise<void> {
  if (afterTasks.length === 0) return
  await runAfterTasks(afterTasks, item ?? {})
}

/**
 * The delete tail of the pipeline: skips the input-shaping phases and runs
 * only validate/field-validate before the DB delete, then the after-hooks.
 * Returns the deleted row as-is (no Field Visibility pass).
 */
async function runDeletePath(args: {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  context: AccessContext
  originalItem: Record<string, unknown> | undefined
  model: PrismaModel
  strategy: WriteStrategy
}): Promise<Record<string, unknown>> {
  const { listName, listConfig, context, originalItem, model, strategy } = args
  const item = originalItem as Record<string, unknown>

  // ── Phase 3: list-level validate (delete) ──────────────────────────────────
  await executeValidate(listConfig.hooks, {
    listKey: listName,
    operation: 'delete',
    item,
    context,
  })

  // ── Phase 3.5: field-level validate (delete) ────────────────────────────────
  await executeFieldValidateHooks(
    undefined,
    undefined,
    listConfig.fields,
    'delete',
    context,
    listName,
    item,
  )

  // ── Phase 6: field-level beforeOperation (delete) ───────────────────────────
  await executeFieldBeforeOperationHooks(
    {},
    {},
    listConfig.fields,
    'delete',
    context,
    listName,
    item,
  )

  // ── Phase 7: list-level beforeOperation (delete) ────────────────────────────
  await executeBeforeOperation(listConfig.hooks, {
    listKey: listName,
    operation: 'delete',
    item,
    context,
  })

  // ── Phase 8: DB delete ──────────────────────────────────────────────────────
  const deleted = await strategy.persist(model, {})

  // ── Phase 9: list-level afterOperation (delete) ─────────────────────────────
  await executeAfterOperation(listConfig.hooks, {
    listKey: listName,
    operation: 'delete',
    originalItem: item,
    context,
  })

  // ── Phase 10: field-level afterOperation (delete) ───────────────────────────
  await executeFieldAfterOperationHooks(
    deleted,
    undefined,
    undefined,
    listConfig.fields,
    'delete',
    context,
    listName,
    item, // original row before deletion
  )

  return deleted
}

// ── Per-operation strategies ──────────────────────────────────────────────────

/**
 * Create strategy for {@link WriteStrategy}.
 *
 * Axis 1: checks `create` access with no existing row; a filter result
 * proceeds with no re-check (unlike update/delete). Enforces the
 * singleton-create constraint even under sudo.
 * Axis 2: runs all input phases.
 * Axis 3: `model.create({ data })`, prepending `id: 1` for singleton lists.
 */
export function createWriteStrategy(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  context: AccessContext,
): WriteStrategy {
  const singleton = isSingletonList(listConfig)
  return {
    operation: 'create',
    runInputPhases: true,
    async resolveTarget(model) {
      // Singleton constraint is enforced even under sudo.
      if (singleton) {
        const existingCount = await model.count()
        if (existingCount > 0) {
          throw new ValidationError(
            [`Cannot create: ${listName} is a singleton list with an existing record`],
            {},
          )
        }
      }

      if (!context._isSudo) {
        const accessResult = await checkAccess(listConfig.access?.operation?.create, {
          session: context.session,
          context,
        })
        if (accessResult === false) {
          return { status: 'denied' }
        }
      }

      return { status: 'ok', originalItem: undefined }
    },
    async persist(model, data, include) {
      // Singleton lists use Int @id with value always 1 (matching Keystone 6).
      const createData = singleton ? { id: 1, ...data } : data
      return model.create(include ? { data: createData, include } : { data: createData })
    },
  }
}

/**
 * Build the shared target resolution for update/delete: fetch the row (missing
 * → denied), check operation-level access (false → denied), and if access
 * returns a filter, re-check via `findFirst(mergeFilters(where, filter))`
 * (no match → denied). An access result of `true` proceeds with no re-check.
 */
function resolveExistingTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  context: AccessContext,
  where: { id: string },
  access: 'update' | 'delete',
): (model: PrismaModel) => Promise<TargetResolution> {
  return async (model) => {
    const item = await model.findUnique({ where })
    if (!item) {
      return { status: 'denied' }
    }

    if (!context._isSudo) {
      const accessResult = await checkAccess(listConfig.access?.operation?.[access], {
        session: context.session,
        item,
        context,
      })

      if (accessResult === false) {
        return { status: 'denied' }
      }

      // A filter result must additionally match the target row.
      if (typeof accessResult === 'object') {
        const matchesFilter = await model.findFirst({
          where: mergeFilters(where, accessResult) ?? {},
        })
        if (!matchesFilter) {
          return { status: 'denied' }
        }
      }
    }

    return { status: 'ok', originalItem: item }
  }
}

/**
 * Update strategy for {@link WriteStrategy}.
 *
 * Axis 1: fetch row, check `update` access, re-check filter results.
 * Axis 2: runs all input phases.
 * Axis 3: `model.update({ where, data })`; afterOperation gets `originalItem`.
 */
export function updateWriteStrategy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  context: AccessContext,
  where: { id: string },
): WriteStrategy {
  return {
    operation: 'update',
    runInputPhases: true,
    resolveTarget: resolveExistingTarget(listConfig, context, where, 'update'),
    async persist(model, data, include) {
      return model.update(include ? { where, data, include } : { where, data })
    },
  }
}

/**
 * Delete strategy for {@link WriteStrategy}.
 *
 * Axis 1: enforce singleton constraint (even under sudo), fetch row, check
 * `delete` access, re-check filter results.
 * Axis 2: skips input phases (runs only validate/field-validate).
 * Axis 3: `model.delete({ where })`; afterOperation gets `originalItem`.
 */
export function deleteWriteStrategy(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  context: AccessContext,
  where: { id: string },
): WriteStrategy {
  const resolveTarget = resolveExistingTarget(listConfig, context, where, 'delete')
  return {
    operation: 'delete',
    runInputPhases: false,
    async resolveTarget(model) {
      // Singleton lists may not be deleted (enforced even under sudo).
      if (isSingletonList(listConfig)) {
        throw new ValidationError([`Cannot delete: ${listName} is a singleton list`], {})
      }
      return resolveTarget(model)
    },
    async persist(model) {
      return model.delete({ where })
    },
  }
}
