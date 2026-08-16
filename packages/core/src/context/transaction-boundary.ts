import type { OpenSaasConfig, ListConfig, FieldConfig } from '../config/types.js'
import type { AccessContext, PrismaClientLike } from '../access/types.js'
import { getRelatedListConfig } from '../access/index.js'
import {
  executeBeforeTransaction,
  executeAfterTransaction,
  executeFieldBeforeTransactionHooks,
  executeFieldAfterTransactionHooks,
  type TransactionOutcome,
} from '../hooks/index.js'
import type { WriteOperation } from './write-pipeline.js'
import type {
  TransactionRegistry,
  TransactionSettleOutcome,
} from '../access/transaction-registry.js'

/**
 * Transaction-boundary hooks (#590 / ADR-0010).
 *
 * `beforeTransaction`/`afterTransaction` run OUTSIDE the write's `$transaction`
 * — `beforeTransaction` before it opens, `afterTransaction` after it settles —
 * for non-transactional side effects (e.g. external API calls) that must not
 * hold a DB transaction open and cannot be rolled back. The pair forms a
 * compensation bracket around the atomic write described by ADR-0010.
 *
 * This module:
 *  1. Enumerates the lists involved in a write up front, BY WALKING THE INPUT
 *     TREE only (no DB reads), so the bracket can run per involved list before
 *     the transaction opens (mirroring how in-transaction before/afterOperation
 *     fire per record, but at list granularity).
 *  2. Runs all `beforeTransaction` hooks, tracking exactly which involved lists'
 *     `beforeTransaction` ran, then — after the caller settles the transaction —
 *     runs `afterTransaction` ONLY for those lists (the symmetric-bracket
 *     "always-run" rule), surfacing any hook errors afterward.
 */

/**
 * One list involved in a write, with the data the transaction-boundary hooks
 * receive. Enumerated purely from the input tree (no DB reads).
 *
 * The persisted/pre-write rows (`item`/`originalItem`) are surfaced to
 * `afterTransaction` ONLY for the TOP-LEVEL record (`isTopLevel`). For nested
 * lists the per-record persisted row is not reliably recoverable outside the
 * transaction, so they are passed as `undefined` rather than mis-handing the
 * top-level row as if it were the nested row. `originalItem` here is therefore
 * populated only for the top-level update/delete target (the pipeline resolves
 * it before the transaction opens).
 */
export interface InvolvedList {
  listKey: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  operation: WriteOperation
  /** Whether this is the top-level write target (the only list with a reliable persisted row). */
  isTopLevel: boolean
  /** The input payload for this involvement (create/update); `undefined` for delete. */
  inputData: Record<string, unknown> | undefined
  /** The existing row for the TOP-LEVEL update/delete target; `undefined` otherwise. */
  originalItem: Record<string, unknown> | undefined
}

/** Nested-op kinds whose payloads imply an involved list + operation. */
const NESTED_OP_OPERATIONS: ReadonlyArray<{ kind: string; operation: WriteOperation }> = [
  { kind: 'create', operation: 'create' },
  { kind: 'update', operation: 'update' },
  { kind: 'delete', operation: 'delete' },
  // connectOrCreate's create branch may create; treat as a possible create involvement.
  { kind: 'connectOrCreate', operation: 'create' },
]

/** Distinct dedupe-key operations `NESTED_OP_OPERATIONS` can produce (create/update/delete). */
const DISTINCT_OPERATION_COUNT = new Set(NESTED_OP_OPERATIONS.map((o) => o.operation)).size

function isRelationshipField(fieldConfig: FieldConfig | undefined): boolean {
  return fieldConfig?.type === 'relationship'
}

/**
 * The number of distinct (listKey, operation) involvement pairs the walk
 * could ever record starting from `startListName` — computed from the
 * CONFIG's relationship graph (not the payload), so it bounds the walk by
 * what the schema can reach rather than by an arbitrary depth.
 *
 * Used as the saturation bound: once `walkNested` has recorded this many
 * pairs, no further pair can be new, so it stops descending. This replaces
 * the old depth cap as the cost bound (#835) — a payload nesting the config's
 * lists more deeply than any previous cap no longer loses their
 * transaction-boundary hooks, while a payload that repeats the same few
 * lists still terminates promptly instead of walking every entry.
 */
function countReachableInvolvementPairs(
  startListName: string,
  startListConfig: ListConfig<any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  config: OpenSaasConfig,
): number {
  const visited = new Set<string>([startListName])
  const queue: Array<ListConfig<any>> = [startListConfig] // eslint-disable-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const fieldConfig of Object.values(current.fields)) {
      if (!isRelationshipField(fieldConfig)) continue
      const relationshipField = fieldConfig as { type: 'relationship'; ref: string }
      const related = getRelatedListConfig(relationshipField.ref, config)
      if (!related || visited.has(related.listName)) continue
      visited.add(related.listName)
      queue.push(related.listConfig)
    }
  }

  return visited.size * DISTINCT_OPERATION_COUNT
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (value == null) return []
  if (Array.isArray(value)) return value.filter((v) => v && typeof v === 'object')
  if (typeof value === 'object') return [value as Record<string, unknown>]
  return []
}

/**
 * Extract the create/update payload from a nested-op entry so nested
 * `beforeTransaction` receives meaningful `inputData`.
 *
 *  - `create`: the entry itself is the create data.
 *  - `update`: the entry's `data`.
 *  - `connectOrCreate`: the entry's `create`.
 *  - `delete`: no input payload.
 */
function nestedInputData(
  kind: string,
  entry: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (kind === 'update') {
    const data = entry.data
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined
  }
  if (kind === 'connectOrCreate') {
    const create = entry.create
    return create && typeof create === 'object' ? (create as Record<string, unknown>) : undefined
  }
  if (kind === 'delete') return undefined
  // create
  return entry
}

/**
 * Recursively walk a write payload's relationship fields, appending one
 * {@link InvolvedList} per nested create/update/delete involvement. De-dups by
 * (listKey, operation) so a list with many nested records of the same operation
 * fires its transaction-boundary bracket once (these hooks are a per-LIST
 * compensation bracket, not per-record).
 */
function walkNested(
  data: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  out: InvolvedList[],
  seen: Set<string>,
  maxPairs: number,
): void {
  // Every reachable pair is already recorded — no further recursion can add
  // anything new, so stop instead of re-walking the rest of the payload.
  if (!data || seen.size >= maxPairs) return

  for (const [fieldName, value] of Object.entries(data)) {
    const fieldConfig = fieldConfigs[fieldName]
    if (!isRelationshipField(fieldConfig) || value == null || typeof value !== 'object') continue

    const relationshipField = fieldConfig as { type: 'relationship'; ref: string }
    const related = getRelatedListConfig(relationshipField.ref, config)
    if (!related) continue
    const { listName: relatedListName, listConfig: relatedListConfig } = related

    const valueRecord = value as Record<string, unknown>
    for (const { kind, operation } of NESTED_OP_OPERATIONS) {
      const opValue = valueRecord[kind]
      if (opValue === undefined) continue

      const entries = asRecordArray(opValue)
      // Record the involvement once per (list, operation).
      const dedupeKey = `${relatedListName}:${operation}`
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey)
        out.push({
          listKey: relatedListName,
          listConfig: relatedListConfig,
          operation,
          isTopLevel: false,
          inputData: entries.length > 0 ? nestedInputData(kind, entries[0]) : undefined,
          originalItem: undefined,
        })
      }

      if (seen.size >= maxPairs) return

      // Recurse into each nested entry's own relationship payload.
      for (const entry of entries) {
        const childData = nestedInputData(kind, entry)
        walkNested(childData, relatedListConfig.fields, config, out, seen, maxPairs)
      }
    }
  }
}

/**
 * Enumerate the lists involved in a write — the top-level list plus every
 * nested create/update/delete target reachable from the input tree — WITHOUT
 * any DB reads. The top-level list is always first.
 */
export function enumerateInvolvedLists(args: {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  operation: WriteOperation
  inputData: Record<string, unknown> | undefined
  /** Top-level existing row (update/delete), resolved before the transaction by the caller. */
  topLevelOriginalItem: Record<string, unknown> | undefined
  config: OpenSaasConfig
}): InvolvedList[] {
  const { listName, listConfig, operation, inputData, topLevelOriginalItem, config } = args

  const out: InvolvedList[] = [
    {
      listKey: listName,
      listConfig,
      operation,
      isTopLevel: true,
      inputData,
      originalItem: topLevelOriginalItem,
    },
  ]
  const seen = new Set<string>([`${listName}:${operation}`])
  const maxPairs = countReachableInvolvementPairs(listName, listConfig, config)

  // Delete has no nested payload to walk (inputData is undefined).
  walkNested(inputData, listConfig.fields, config, out, seen, maxPairs)

  return out
}

/**
 * Run the list- and field-level `beforeTransaction` hooks for one involved list.
 * A throw propagates to the caller (which aborts the write).
 */
async function runBeforeTransactionForList<TPrisma extends PrismaClientLike>(
  involved: InvolvedList,
  context: AccessContext<TPrisma>,
): Promise<void> {
  const { listKey, listConfig, operation, inputData, originalItem } = involved

  if (operation === 'create') {
    await executeBeforeTransaction(listConfig.hooks, {
      listKey,
      operation: 'create',
      inputData: inputData ?? {},
      context,
    })
  } else if (operation === 'update') {
    await executeBeforeTransaction(listConfig.hooks, {
      listKey,
      operation: 'update',
      inputData: inputData ?? {},
      item: originalItem,
      context,
    })
  } else {
    await executeBeforeTransaction(listConfig.hooks, {
      listKey,
      operation: 'delete',
      item: originalItem,
      context,
    })
  }

  await executeFieldBeforeTransactionHooks(
    inputData,
    listConfig.fields,
    operation,
    context,
    listKey,
    originalItem,
  )
}

/**
 * Run the list- and field-level `afterTransaction` hooks for one involved list
 * with the settled {@link TransactionOutcome}. Collects (does not throw) any
 * errors so the caller can keep running the remaining lists' compensators.
 *
 * Exported for {@link TransactionRegistry}-drained (deferred, joined-write)
 * flushes, which run this same per-list logic once the transaction owner
 * observes the real settle (ADR-0028).
 */
export async function runAfterTransactionForList<TPrisma extends PrismaClientLike>(
  involved: InvolvedList,
  outcome: TransactionOutcome,
  context: AccessContext<TPrisma>,
  errors: unknown[],
): Promise<void> {
  const { listKey, listConfig, operation, isTopLevel, inputData, originalItem } = involved

  // On commit, the persisted row (`outcome.item`) is the TOP-LEVEL row. We only
  // surface `item`/`originalItem` for the top-level list — handing the top-level
  // row to a nested list's hook (whose type is the nested list's own item) would
  // be unsound, since the hook would silently read the wrong record. For nested
  // lists we pass `undefined`; per-record nested compensation must use the
  // in-transaction `afterOperation`, which already receives the correct nested row.
  try {
    if (outcome.status === 'committed') {
      // The persisted row is surfaced only for the top-level list (see above).
      const committedItem = isTopLevel ? outcome.item : undefined
      if (operation === 'create') {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'create',
          status: 'committed',
          inputData: inputData ?? {},
          item: committedItem,
          context,
        })
      } else if (operation === 'update') {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'update',
          status: 'committed',
          inputData: inputData ?? {},
          originalItem: isTopLevel ? originalItem : undefined,
          item: committedItem,
          context,
        })
      } else {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'delete',
          status: 'committed',
          originalItem: isTopLevel ? originalItem : undefined,
          context,
        })
      }
    } else {
      // rolled-back: no persisted item.
      if (operation === 'create') {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'create',
          status: 'rolled-back',
          inputData: inputData ?? {},
          error: outcome.error,
          context,
        })
      } else if (operation === 'update') {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'update',
          status: 'rolled-back',
          inputData: inputData ?? {},
          originalItem,
          error: outcome.error,
          context,
        })
      } else {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'delete',
          status: 'rolled-back',
          originalItem,
          error: outcome.error,
          context,
        })
      }
    }
  } catch (err) {
    // A throwing afterTransaction must NOT stop the remaining compensators.
    errors.push(err)
  }

  try {
    await executeFieldAfterTransactionHooks(
      outcome,
      inputData,
      listConfig.fields,
      operation,
      context,
      listKey,
      isTopLevel,
      originalItem,
    )
  } catch (err) {
    errors.push(err)
  }
}

/**
 * Aggregated error surfaced when one or more `afterTransaction` hooks throw.
 * The DB state is already final; all compensators still ran.
 */
export class AfterTransactionError extends Error {
  public errors: unknown[]
  constructor(errors: unknown[]) {
    super(
      `afterTransaction hook(s) failed: ${errors
        .map((e) => (e instanceof Error ? e.message : String(e)))
        .join('; ')}`,
    )
    this.name = 'AfterTransactionError'
    this.errors = errors
  }
}

/**
 * Compute a joined write's FINAL outcome once its owner's settle is known
 * (ADR-0028): the write's own error always wins (it never fires early — see
 * the ADR's provider-dependent-early-settle rejection); otherwise the write
 * committed if and only if the owner's transaction also committed.
 */
function resolveDeferredOutcome(
  writeOutcome: TransactionOutcome,
  settle: TransactionSettleOutcome,
): TransactionOutcome {
  if (writeOutcome.status === 'rolled-back') return writeOutcome
  if (settle.status === 'committed') return writeOutcome
  return { status: 'rolled-back', error: settle.error }
}

/**
 * Bracket a write's transaction with the transaction-boundary hooks (#590,
 * ADR-0028 / #899).
 *
 * Sequence:
 *  1. Run every involved list's `beforeTransaction` in order, tracking which
 *     ran (always eager — ADR-0028 keeps the symmetric bracket's "before" half
 *     synchronous even for a joined write). A throw aborts: the transaction is
 *     NEVER opened, and the throw is re-surfaced.
 *  2. Otherwise run `runTransaction` (the existing #569 machinery — opens a
 *     real transaction, joins one already open, or runs directly against a
 *     client with no transaction support at all).
 *  3. What happens to `afterTransaction` next depends on ownership:
 *     - **Joined** (`args.joinedOwner` set — this write's context is nested in
 *       a transaction it did not open): its bracket is DEFERRED — enqueued on
 *       the owner's {@link TransactionRegistry} instead of firing now. The
 *       owner drains it once it observes the real settle, at which point
 *       {@link resolveDeferredOutcome} decides the final status.
 *     - **Owner** (`args.ownedRegistry` set — this write just opened the
 *       transaction every joined write below it shares): runs its own bracket
 *       eagerly exactly as before, THEN drains `ownedRegistry` with the same
 *       settle outcome so every write that joined this transaction gets its
 *       deferred bracket flushed too.
 *     - **Unowned** (neither set — no `context.transaction()` and no real
 *       transaction to open, e.g. a bare test double): unchanged, fires
 *       eagerly at write time (the "unowned join" case — there is no owner to
 *       defer to and no settle signal to wait for).
 *  4. If any `afterTransaction` throws, the rest still run; the collected
 *     errors are surfaced afterward as an {@link AfterTransactionError} — for
 *     a joined write this surfaces from the OWNER's promise, not this write's.
 *
 * Sudo does not affect these hooks — they always run; sudo only bypasses access.
 */
export async function runWithTransactionBoundary<TPrisma extends PrismaClientLike>(args: {
  involvedLists: InvolvedList[]
  context: AccessContext<TPrisma>
  /** Set when this write is nested in a transaction it did not open (ADR-0028). */
  joinedOwner?: TransactionRegistry
  /** Set when this write just opened the transaction joined writes below it share. */
  ownedRegistry?: TransactionRegistry
  runTransaction: () => Promise<Record<string, unknown> | null>
}): Promise<Record<string, unknown> | null> {
  const { involvedLists, context, joinedOwner, ownedRegistry, runTransaction } = args

  // Lists whose beforeTransaction ran (in order), for the symmetric bracket. A
  // list is marked as "ran" the moment its beforeTransaction BEGINS, so even a
  // list whose beforeTransaction throws gets its afterTransaction (it may have
  // taken a partial external action that needs compensating).
  const ran: InvolvedList[] = []

  let beforeError: unknown
  for (const involved of involvedLists) {
    ran.push(involved)
    try {
      await runBeforeTransactionForList(involved, context)
    } catch (err) {
      beforeError = err
      break
    }
  }

  // beforeTransaction threw → abort: never open the transaction, compensate the
  // lists whose beforeTransaction ran, then surface the original error.
  if (beforeError !== undefined) {
    const outcome: TransactionOutcome = { status: 'rolled-back', error: beforeError }
    if (joinedOwner) {
      // Deferred: matches the eager branch below, which also discards any
      // afterTransaction errors on this path (only beforeError propagates).
      joinedOwner.enqueue(async (_settle, _errors) => {
        const discarded: unknown[] = []
        for (const involved of ran) {
          await runAfterTransactionForList(involved, outcome, context, discarded)
        }
      })
    } else {
      const afterErrors: unknown[] = []
      for (const involved of ran) {
        await runAfterTransactionForList(involved, outcome, context, afterErrors)
      }
    }
    throw beforeError
  }

  // Open (or join) the transaction and capture THIS WRITE's own settle outcome.
  let outcome: TransactionOutcome
  let result: Record<string, unknown> | null = null
  let txError: unknown
  try {
    result = await runTransaction()
    outcome = { status: 'committed', item: result ?? {} }
  } catch (err) {
    txError = err
    outcome = { status: 'rolled-back', error: err }
  }

  if (joinedOwner) {
    // Deferred (ADR-0028): this write cannot observe the enclosing
    // transaction's real settle, so its bracket is queued rather than fired.
    // The write's own result/throw is unaffected — only afterTransaction waits.
    joinedOwner.enqueue(async (settle, errors) => {
      const finalOutcome = resolveDeferredOutcome(outcome, settle)
      for (const involved of ran) {
        await runAfterTransactionForList(involved, finalOutcome, context, errors)
      }
    })
    if (txError !== undefined) throw txError
    return result
  }

  // afterTransaction always runs for every list whose beforeTransaction ran
  // (here: all involved lists). All compensators run even if one throws.
  const afterErrors: unknown[] = []
  for (const involved of ran) {
    await runAfterTransactionForList(involved, outcome, context, afterErrors)
  }

  // This write OWNS the transaction every joined write below it shares — drain
  // their deferred brackets now, with the same settle outcome this write just
  // observed (ADR-0028).
  if (ownedRegistry) {
    const settle: TransactionSettleOutcome =
      txError !== undefined ? { status: 'rolled-back', error: txError } : { status: 'committed' }
    await ownedRegistry.drain(settle, afterErrors)
  }

  // Surface errors: the transaction's own error takes precedence (the write
  // failed); otherwise any afterTransaction errors (own + drained).
  if (txError !== undefined) throw txError
  if (afterErrors.length > 0) throw new AfterTransactionError(afterErrors)

  return result
}
