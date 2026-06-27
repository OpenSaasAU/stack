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
import { getDbKey } from '../lib/case-utils.js'

/**
 * Write Pipeline — the single module that runs the canonical, secured write
 * sequence for one create/update/delete. It owns the phase order in one place;
 * the per-operation differences (target resolution + access, which input phases
 * run, the DB verb and returned row) are supplied by a {@link WriteStrategy}.
 *
 * The phase order is the framework's single most important invariant. See the
 * "Write Pipeline" glossary term in CONTEXT.md and the hooks ordering in
 * CLAUDE.md. Reads (findUnique/findMany) and the two-phase read model
 * (ADR-0001) are intentionally out of scope here.
 */

/**
 * The write operations the pipeline can run.
 */
export type WriteOperation = 'create' | 'update' | 'delete'

/**
 * Result of resolving a write target (axis 1).
 *
 * - `{ status: 'ok', originalItem }` — proceed. `originalItem` is the existing
 *   row for update/delete, or `undefined` for create.
 * - `{ status: 'denied' }` — access denied, missing target, or filter
 *   non-match. The pipeline short-circuits to `null` (silent failure) BEFORE
 *   any input phases, before-hooks, or the DB call.
 */
export type TargetResolution =
  | { status: 'ok'; originalItem: Record<string, unknown> | undefined }
  | { status: 'denied' }

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
 * genuinely differ; the pipeline owns the shared phase order around them.
 *
 *   1. `resolveTarget` — fetch the target row (if any) + operation-level access.
 *   2. `runInputPhases` — whether the resolveInput → validate-hooks → field
 *      rules → filter-writable → nested-ops span runs (create & update: yes;
 *      delete: no).
 *   3. `persist` — the DB verb; returns the row passed through Field Visibility.
 */
export interface WriteStrategy {
  operation: WriteOperation

  /**
   * Axis 1: resolve the target row and check operation-level access. Receives
   * the dynamically-resolved Prisma model so it can fetch rows and perform
   * filter re-checks. Implementations must honour `context._isSudo`.
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
 * runtime from list keys, which is the one place a cast is unavoidable — it is
 * kept localized here (mirroring the existing pattern in `context/index.ts`).
 */
function getModel<TPrisma extends PrismaClientLike>(
  prisma: TPrisma,
  listName: string,
): PrismaModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- model names are generated at runtime
  return (prisma as any)[getDbKey(listName)] as PrismaModel
}

/**
 * Minimal shape of a Prisma interactive-transaction-capable client.
 *
 * The transaction client `tx` is dynamically typed exactly like the model
 * surface above (model names are generated at runtime), so the cast is kept
 * localized and commented per the house rules.
 */
interface TransactionCapable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- $transaction callback receives a dynamically-typed tx client
  $transaction?: (fn: (tx: any) => Promise<unknown>) => Promise<unknown>
}

/**
 * Run `fn` inside ONE interactive transaction (ADR-0010: every write is
 * transactional, so the hook contract does not depend on whether a write
 * happened to be nested). The transaction client `tx` is passed to `fn` and
 * used as the persistence target for the parent + all nested writes, so they
 * are atomic and a throwing hook rolls the whole write back.
 *
 * If the client does not expose `$transaction` (e.g. a test mock), `fn` runs
 * directly against the client — the hook ordering and arguments are identical;
 * only the rollback guarantee is provided by the real transaction.
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

/**
 * Check if a list is configured as a singleton.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function isSingletonList(listConfig: ListConfig<any>): boolean {
  return !!listConfig.isSingleton
}

/**
 * Arguments shared by every write pipeline run.
 */
export interface WritePipelineArgs<TPrisma extends PrismaClientLike> {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  prisma: TPrisma
  context: AccessContext<TPrisma>
  config: OpenSaasConfig
  /** The original input data for the write (create/update). `undefined` for delete. */
  inputData: Record<string, unknown> | undefined
  /** The per-operation strategy supplying the three variation axes. */
  strategy: WriteStrategy
}

/**
 * Run the canonical secured write sequence once.
 *
 * Phase order (owned here, in one place):
 *   resolve target + operation-level access
 *     → list/field `resolveInput`
 *     → list/field `validate`
 *     → built-in field rules (`validateFieldRules`)
 *     → filter writable fields
 *     → nested operations
 *     → list/field `beforeOperation`
 *     → DB
 *     → list/field `afterOperation`
 *     → `filterReadableFields` (Field Visibility)
 *
 * Contract preserved exactly:
 *   - missing target / access denied / filter non-match → `null` (silent),
 *     BEFORE the DB call and BEFORE `beforeOperation`.
 *   - validation failure → THROW `ValidationError` (never silent).
 *   - sudo mode skips access checks and writable-field filtering (the strategy
 *     and `filterWritableFields` both honour `context._isSudo`).
 *   - `afterOperation` receives `originalItem` for update/delete (undefined for
 *     create).
 *   - delete returns the deleted row as-is (no Field Visibility pass), matching
 *     current behaviour.
 */
export async function runWritePipeline<TPrisma extends PrismaClientLike>(
  args: WritePipelineArgs<TPrisma>,
): Promise<Record<string, unknown> | null> {
  const { prisma } = args
  // ADR-0010: every write runs inside ONE interactive transaction. The parent
  // and ALL nested writes share this transaction's client `tx` as their
  // persistence target, so they are atomic and a throwing
  // `beforeOperation`/`afterOperation` (or validation) rolls the whole write
  // back. `runWriteInTransaction` resolves the target row, runs the full hook
  // pipeline, persists, and runs nested + own `afterOperation` — all against
  // `tx`.
  return runInTransaction(prisma, (tx) => runWriteInTransaction({ ...args, prisma: tx }))
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
  // Short-circuits to `null` (silent failure) for missing target, denied
  // access, or filter non-match — before any hook side effects or the DB call.
  const resolution = await strategy.resolveTarget(model)
  if (resolution.status === 'denied') {
    return null
  }
  const originalItem = resolution.originalItem

  // ── Delete path: skip input phases, run only validate/field-validate ────────
  // (matches current delete behaviour exactly).
  if (!strategy.runInputPhases) {
    return runDeletePath({ listName, listConfig, context, originalItem, model, strategy })
  }

  // Only create/update reach here (delete short-circuited above). Narrow the
  // operation so the field-hook helpers receive a 'create' | 'update' value.
  const writeOp: 'create' | 'update' = operation === 'create' ? 'create' : 'update'

  // `inputData` is always present for create/update (the operations that run
  // input phases). Default to {} only as a defensive measure.
  const input = inputData ?? {}

  // ── Phases 2–4: transform + validate span (Hook Pipeline) ──────────────────
  // The Hook Pipeline owns the list/field `resolveInput` → list/field `validate`
  // → built-in field rules span and the `resolvedData` threading through it. It
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
  })

  // ── Phase 5.5: process nested relationship operations ───────────────────────
  // This runs each nested record's resolveInput/validate/field-rules AND its
  // `beforeOperation` (inside this transaction), returning the transformed
  // payload plus deferred `afterOperation` tasks and the relation fields to
  // `include` so those tasks can recover their persisted `item`. All nested DB
  // reads/persistence go through `tx`.
  const { data, afterTasks, includeFields } = await processNestedOperations(
    filteredData,
    listConfig.fields,
    config,
    { ...context, prisma: tx },
    writeOp,
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
  // Ask the DB to return the nested relations that have deferred
  // `afterOperation` tasks so they can recover their persisted `item`.
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
          // originalItem is the row before the update
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
 * row. Defensive guard: if `item` is not a record (test mocks may return
 * unexpected shapes), tasks still run against an empty object so a nested
 * `afterOperation` is never silently skipped.
 */
async function runNestedAfterTasks(
  afterTasks: AfterTask[],
  item: Record<string, unknown>,
): Promise<void> {
  if (afterTasks.length === 0) return
  await runAfterTasks(afterTasks, item ?? {})
}

/**
 * The delete tail of the pipeline: skips the input-shaping phases and runs only
 * validate/field-validate before the DB delete, then the after-hooks. Returns
 * the deleted row as-is (no Field Visibility pass) — matching current delete
 * behaviour exactly.
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
 * Create strategy.
 *
 * Axis 1: checks `create` access with NO existing row. Enforces the
 * singleton-create constraint even under sudo. On create, an access result of
 * `true` OR a filter object both proceed — there is no filter re-check.
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
 * Update strategy.
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
 * Delete strategy.
 *
 * Axis 1: enforce singleton constraint (even under sudo), fetch row, check
 * `delete` access, re-check filter results.
 * Axis 2: SKIPS input phases (runs only validate/field-validate).
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
