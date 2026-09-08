import type { OpenSaasConfig, ListConfig } from '../config/types.js'
import type {
  AccessContext,
  OrmClient,
  OrmRow,
  PrismaFilter,
  TransactionOpener,
} from '../access/types.js'
import {
  checkAccess,
  checkCreateAccess,
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
import {
  countRows,
  deleteFirst,
  firstMatching,
  identityPredicate,
  insertRow,
  updateFirst,
  whereCombinators,
  writeCollection,
  type WhereCombinators,
  type WriteCollection,
  type WriteScope,
} from '../secured/write.js'
import { resolveWhere, type WherePlan } from '../secured/vocabulary.js'
import { hookPipeline } from './hook-pipeline.js'
import { lowerRelationInput, refuseNestedRelationInput } from './relationship-input.js'
import { enumerateInvolvedLists, runWithTransactionBoundary } from './transaction-boundary.js'
import { TransactionRegistry } from '../access/transaction-registry.js'
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
 *
 * `scope` is the predicate the write itself then runs under: the engine's own
 * identity predicate, and the Access Filter beside it when the list's rule
 * returned one, so an `UPDATE` is scoped by the same filter the target read
 * was (ADR-0044).
 */
export type TargetResolution =
  { status: 'ok'; originalItem: OrmRow | undefined; scope: WriteScope } | { status: 'denied' }

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
  resolveTarget(collection: WriteCollection, ops: WhereCombinators): Promise<TargetResolution>

  /**
   * Axis 2: whether to run the input-shaping phases (resolveInput → validate
   * hooks → built-in field rules → filter-writable). Delete runs only its
   * `validate`/field-validate hooks and skips the rest.
   */
  runInputPhases: boolean

  /**
   * Axis 3: execute the database write and return the persisted/deleted row,
   * or `null` when the scope matched nothing. `data` is the fully-resolved
   * write payload (empty object for delete).
   */
  persist(
    collection: WriteCollection,
    ops: WhereCombinators,
    scope: WriteScope,
    data: Record<string, unknown>,
  ): Promise<OrmRow | null>
}

/**
 * Run `fn` inside ONE transaction (ADR-0010).
 *
 * With no `opener`, `fn` runs directly against the handle it was given. Hook
 * ordering and arguments are identical either way, but only a real transaction
 * carries the rollback guarantee.
 *
 * Known limits — the absent opener does not by itself mean an enclosing
 * transaction is open. It covers two shapes and cannot tell them apart:
 * a Joined write, the Unowned join of ADR-0028, whose context was rebound to a
 * transaction someone else opened; and a context assembled without a Prisma 8
 * client at all — a hand-built ORM double — where nothing is open around the
 * write and it simply has no rollback guarantee. The signal that a write is
 * joined is `existingOwner` in {@link runWritePipeline}, not this parameter.
 */
async function runInTransaction(
  opener: TransactionOpener | undefined,
  ormHandle: OrmClient,
  fn: (tx: OrmClient) => Promise<OrmRow | null>,
): Promise<OrmRow | null> {
  if (opener === undefined) return fn(ormHandle)
  return opener((opened) => fn(opened.ormHandle))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function isSingletonList(listConfig: ListConfig<any>): boolean {
  return !!listConfig.isSingleton
}

export interface WritePipelineArgs {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  ormHandle: OrmClient
  context: AccessContext
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
export async function runWritePipeline(args: WritePipelineArgs): Promise<OrmRow | null> {
  const { ormHandle, listName, listConfig, context, config, inputData, strategy } = args
  const ops = await whereCombinators()

  // ── Pre-transaction access gate (#590) ──────────────────────────────────────
  // Resolves the top-level target + access OUTSIDE the transaction so a denied
  // write short-circuits to `null` WITHOUT firing beforeTransaction/
  // afterTransaction — a denied write takes no external action, so the
  // boundary hooks must not run. The result feeds `preResolvedTarget` and is
  // REUSED inside the transaction rather than re-resolved, keeping the target
  // read exactly once (#569).
  const gate = await strategy.resolveTarget(writeCollection(ormHandle, listName), ops)
  if (gate.status === 'denied') {
    return null
  }

  // A payload-shape refusal, after the access gate so a denied caller learns
  // nothing about this list's fields from it (ADR-0031).
  refuseNestedRelationInput(listName, listConfig, config, inputData)

  const involvedLists = enumerateInvolvedLists({
    listName,
    listConfig,
    operation: strategy.operation,
    inputData,
    originalItem: gate.originalItem,
  })

  // ── Transaction ownership for the transaction-boundary hooks (ADR-0028) ────
  // A context carrying `_transactionOwner` is JOINING an enclosing transaction
  // it did not open — defer to that owner even if this context could open one.
  // Otherwise this write becomes the owner: the registry every joined write
  // below it enqueues into.
  const existingOwner = context._transactionOwner
  const opener = existingOwner ? undefined : context._transactionOpener
  const ownedRegistry = opener ? new TransactionRegistry() : undefined
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
      runInTransaction(opener, ormHandle, (tx) =>
        runWriteInTransaction(
          {
            ...args,
            ormHandle: tx,
            // Reuse the pre-transaction target resolution (#569 call-count semantics).
            preResolvedTarget: gate,
            // Rebind context.db/ormHandle to `tx` (ADR-0010 atomicity) and carry the
            // transaction owner (ADR-0028) — see bindContextToTransaction below.
            context: bindContextToTransaction(args, tx, transactionOwnerForBody),
          },
          ops,
        ),
      ),
  })
}

/**
 * Build an {@link AccessContext} whose `db`/`ormHandle` target the transaction
 * client `tx`, so a `context.db` write a hook performs runs inside — and rolls
 * back with — this write's transaction (ADR-0010).
 *
 * The access-controlled `db` delegates capture their Prisma client at
 * construction, so swapping `context.ormHandle` alone would not rebind `db` — we
 * rebuild the delegates against `tx` via {@link buildDbDelegate}, reusing the
 * request context's `session`, `storage`, `plugins`, `_isSudo`, and
 * `_resolveOutputChain` as-is (so a write from inside a `resolveOutput` hook
 * keeps that hook's chain). Plugin runtimes are NOT re-executed.
 *
 * `transactionOwner` (ADR-0028) is carried onto the rebuilt context so a hook's
 * own `context.db` write defers its transaction-boundary bracket to that owner
 * instead of firing eagerly.
 *
 * The lock lane (ADR-0047) is carried only when `tx` IS the handle the context
 * already had — the joined-write shape, where this write runs inside a
 * transaction someone else opened and the lane is that transaction's. When
 * this write opened its own, the lane belongs to a different transaction than
 * `tx`, and a hook reaching `forUpdate()` through it would take the lock on
 * the wrong connection; it is dropped, and refused as unavailable.
 *
 * That drop is defence in depth rather than a live branch: `_rowLock` is set
 * only with an `_unsafeTransaction` and `_transactionOpener` only without one,
 * so a context that could open its own transaction here never carries a lane
 * to drop. Deleting the check changes no test.
 */
function bindContextToTransaction(
  args: WritePipelineArgs,
  tx: OrmClient,
  transactionOwner: TransactionRegistry | undefined,
): AccessContext {
  const { context, config } = args
  const txContext: AccessContext = {
    session: context.session,
    ormHandle: tx,
    db: context.db,
    storage: context.storage,
    plugins: context.plugins,
    _isSudo: context._isSudo,
    _resolveOutputChain: context._resolveOutputChain,
    _transactionOwner: transactionOwner,
    _rowLock: tx === context.ormHandle ? context._rowLock : undefined,
  }
  // Rebuild `db` against `tx`, referencing `txContext` itself so hooks reached
  // through it see the transactional context.
  txContext.db = buildDbDelegate(config, tx, txContext)
  return txContext
}

/**
 * The body of one secured write, executed against the transaction client `tx`
 * (passed in as `args.ormHandle`). Returns `null` for the silent-failure cases and
 * the Field-Visibility-filtered row otherwise. Any throw here propagates out of
 * `runInTransaction` and rolls the transaction back.
 */
async function runWriteInTransaction(
  args: WritePipelineArgs,
  ops: WhereCombinators,
): Promise<OrmRow | null> {
  const { listName, listConfig, ormHandle: tx, context, config, inputData, strategy } = args
  const { operation } = strategy
  const collection = writeCollection(tx, listName)

  // ── Phase 1: resolve target + operation-level access ──────────────────────
  // Reuses `preResolvedTarget` from the pre-transaction gate rather than
  // reading the target twice; falls back to resolving here when invoked
  // directly (e.g. a unit test) without that bracket.
  const resolution = args.preResolvedTarget ?? (await strategy.resolveTarget(collection, ops))
  if (resolution.status === 'denied') {
    return null
  }
  const { originalItem, scope } = resolution

  // ── Delete path: skip input phases, run only validate/field-validate ────────
  if (!strategy.runInputPhases) {
    return runDeletePath({
      listName,
      listConfig,
      context,
      originalItem,
      collection,
      ops,
      scope,
      strategy,
    })
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

  // The same payload-shape refusal, over what the hooks produced: a
  // `resolveInput` that assembles a relation payload writes it into
  // `resolvedData`, which the pre-transaction check could not see.
  refuseNestedRelationInput(listName, listConfig, config, resolvedData)

  // ── Phase 5: filter writable fields (field-level access, skip if sudo) ──────
  const data = await filterWritableFields(resolvedData, listConfig.fields, writeOp, {
    session: context.session,
    item: originalItem,
    context: { ...context, _isSudo: context._isSudo },
    inputData: input,
    listName,
    config,
  })

  // ── Phase 5.5: relationship resolution (ADR-0050) ──────────────────────────
  // `connect` becomes a foreign key once the reachability query says the caller
  // may see that row, and `null` clears the same column. An unreachable target
  // is the silent `null` every other denial is, before `beforeOperation` runs.
  const linked = await lowerRelationInput({
    listName,
    listConfig,
    config,
    context,
    ormHandle: tx,
    ops,
    data,
  })
  if (linked.status === 'unreachable') return null
  const writeData = linked.data

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
  const item = await strategy.persist(collection, ops, scope, writeData)
  // The scope matched nothing this time: the target was read under the same
  // predicate moments earlier in this transaction, so the row is gone —
  // dropped by a `beforeOperation` hook's own write, typically. `null` is
  // denied-or-gone on every terminal, and no after-hook fires for a write
  // that did not happen.
  if (item === null) return null

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
 * The delete tail of the pipeline: skips the input-shaping phases and runs
 * only validate/field-validate before the DB delete, then the after-hooks.
 * Returns the deleted row as-is (no Field Visibility pass).
 */
async function runDeletePath(args: {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  context: AccessContext
  originalItem: OrmRow | undefined
  collection: WriteCollection
  ops: WhereCombinators
  scope: WriteScope
  strategy: WriteStrategy
}): Promise<OrmRow | null> {
  const { listName, listConfig, context, originalItem, collection, ops, scope, strategy } = args
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
  const deleted = await strategy.persist(collection, ops, scope, {})
  if (deleted === null) return null

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
 * throws `InvalidCreateAccessResultError` rather than proceeding unchecked —
 * create has no row to re-check a filter against, unlike update/delete
 * (#1009). Enforces the singleton-create constraint even under sudo.
 * Axis 2: runs all input phases.
 * Axis 3: `collection.create(row)`, prepending `id: 1` for singleton lists.
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
    async resolveTarget(collection) {
      // Singleton constraint is enforced even under sudo.
      if (singleton) {
        const existing = await countRows(collection, listName)
        if (existing > 0) {
          throw new ValidationError(
            [`Cannot create: ${listName} is a singleton list with an existing record`],
            {},
          )
        }
      }

      if (!context._isSudo) {
        const allowed = await checkCreateAccess(listName, listConfig.access?.operation?.create, {
          session: context.session,
          context,
        })
        if (!allowed) {
          return { status: 'denied' }
        }
      }

      return { status: 'ok', originalItem: undefined, scope: [] }
    },
    async persist(collection, _ops, _scope, data) {
      // Singleton lists use Int @id with value always 1 (matching Keystone 6).
      return insertRow(collection, singleton ? { id: 1, ...data } : data)
    },
  }
}

/**
 * The Access Filter as a predicate to AND into the write's own, lowered
 * through the same seam a read lowers it through: trusted config, so its keys
 * are not read-gated, but total, so a rule that resolved to `undefined` is
 * refused rather than dropped (ADR-0022, ADR-0055).
 */
async function accessFilterPlan(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  context: AccessContext,
  filter: PrismaFilter,
): Promise<WherePlan> {
  return await resolveWhere(filter, {
    listName,
    listConfig,
    config,
    session: context.session,
    context,
    checkFieldRead: false,
    applyRelationAccess: true,
    accessFilterPath: [listName],
  })
}

/**
 * Build the shared target resolution for update/delete: read the row by
 * identity (missing → denied), check operation-level access (false → denied),
 * and if access returns a filter, re-read under the filter as well (no match →
 * denied) and carry it forward as part of the write's own predicate.
 *
 * The second read is what gates the hooks: a filter non-match must short-
 * circuit to `null` before `beforeOperation` runs, which a scope merged into
 * the write alone could not do.
 */
function resolveExistingTarget(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  context: AccessContext,
  where: { id: string | number },
  access: 'update' | 'delete',
): (collection: WriteCollection, ops: WhereCombinators) => Promise<TargetResolution> {
  return async (collection, ops) => {
    const identity = identityPredicate(listName, where.id)
    const item = await firstMatching(collection, [identity], ops)
    if (!item) {
      return { status: 'denied' }
    }

    if (context._isSudo) {
      return { status: 'ok', originalItem: item, scope: [identity] }
    }

    const accessResult = await checkAccess(listConfig.access?.operation?.[access], {
      session: context.session,
      item,
      context,
    })

    if (accessResult === false) {
      return { status: 'denied' }
    }

    if (accessResult === true) {
      return { status: 'ok', originalItem: item, scope: [identity] }
    }

    const filter = await accessFilterPlan(listName, listConfig, config, context, accessResult)
    const scope: WriteScope = [identity, filter]
    const scopedItem = await firstMatching(collection, scope, ops)
    if (!scopedItem) {
      return { status: 'denied' }
    }

    return { status: 'ok', originalItem: item, scope }
  }
}

/**
 * Update strategy for {@link WriteStrategy}.
 *
 * Axis 1: read the row, check `update` access, re-read under a filter result.
 * Axis 2: runs all input phases.
 * Axis 3: `collection.where(scope).update(row)`; afterOperation gets `originalItem`.
 */
export function updateWriteStrategy(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  context: AccessContext,
  where: { id: string | number },
): WriteStrategy {
  return {
    operation: 'update',
    runInputPhases: true,
    resolveTarget: resolveExistingTarget(listName, listConfig, config, context, where, 'update'),
    async persist(collection, ops, scope, data) {
      return updateFirst(collection, scope, ops, data)
    },
  }
}

/**
 * Delete strategy for {@link WriteStrategy}.
 *
 * Axis 1: enforce singleton constraint (even under sudo), read the row, check
 * `delete` access, re-read under a filter result.
 * Axis 2: skips input phases (runs only validate/field-validate).
 * Axis 3: `collection.where(scope).delete()`; afterOperation gets `originalItem`.
 */
export function deleteWriteStrategy(
  listName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>,
  config: OpenSaasConfig,
  context: AccessContext,
  where: { id: string | number },
): WriteStrategy {
  const resolveTarget = resolveExistingTarget(
    listName,
    listConfig,
    config,
    context,
    where,
    'delete',
  )
  return {
    operation: 'delete',
    runInputPhases: false,
    async resolveTarget(collection, ops) {
      // Singleton lists may not be deleted (enforced even under sudo).
      if (isSingletonList(listConfig)) {
        throw new ValidationError([`Cannot delete: ${listName} is a singleton list`], {})
      }
      return resolveTarget(collection, ops)
    },
    async persist(collection, ops, scope) {
      return deleteFirst(collection, scope, ops)
    },
  }
}
