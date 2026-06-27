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
 * `originalItem` is best-effort: present for the TOP-LEVEL update/delete target
 * (the pipeline resolves it before the transaction opens) and `undefined` for
 * nested targets (not resolved at the boundary to avoid pre-transaction reads).
 */
export interface InvolvedList {
  listKey: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  operation: WriteOperation
  /** The input payload for this involvement (create/update); `undefined` for delete. */
  inputData: Record<string, unknown> | undefined
  /** The existing row for the TOP-LEVEL update/delete target; `undefined` otherwise. */
  originalItem: Record<string, unknown> | undefined
}

/** Max nesting depth walked when enumerating involved lists (matches nested-operations). */
const MAX_DEPTH = 5

/** Nested-op kinds whose payloads imply an involved list + operation. */
const NESTED_OP_OPERATIONS: ReadonlyArray<{ kind: string; operation: WriteOperation }> = [
  { kind: 'create', operation: 'create' },
  { kind: 'update', operation: 'update' },
  { kind: 'delete', operation: 'delete' },
  // connectOrCreate's create branch may create; treat as a possible create involvement.
  { kind: 'connectOrCreate', operation: 'create' },
]

function isRelationshipField(fieldConfig: FieldConfig | undefined): boolean {
  return fieldConfig?.type === 'relationship'
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
  depth: number,
): void {
  if (!data || depth >= MAX_DEPTH) return

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
          inputData: entries.length > 0 ? nestedInputData(kind, entries[0]) : undefined,
          originalItem: undefined,
        })
      }

      // Recurse into each nested entry's own relationship payload.
      for (const entry of entries) {
        const childData = nestedInputData(kind, entry)
        walkNested(childData, relatedListConfig.fields, config, out, seen, depth + 1)
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
      inputData,
      originalItem: topLevelOriginalItem,
    },
  ]
  const seen = new Set<string>([`${listName}:${operation}`])

  // Delete has no nested payload to walk (inputData is undefined).
  walkNested(inputData, listConfig.fields, config, out, seen, 0)

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
 */
async function runAfterTransactionForList<TPrisma extends PrismaClientLike>(
  involved: InvolvedList,
  outcome: TransactionOutcome,
  context: AccessContext<TPrisma>,
  errors: unknown[],
): Promise<void> {
  const { listKey, listConfig, operation, inputData, originalItem } = involved

  // On commit, the persisted top-level row is the outcome item. For nested
  // lists we cannot recover the persisted row outside the transaction, so the
  // committed `item` we surface is the top-level persisted row. (afterOperation
  // — the in-transaction hook — already gave nested records their own row.)
  try {
    if (outcome.status === 'committed') {
      if (operation === 'create') {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'create',
          status: 'committed',
          inputData: inputData ?? {},
          item: outcome.item,
          context,
        })
      } else if (operation === 'update') {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'update',
          status: 'committed',
          inputData: inputData ?? {},
          originalItem: originalItem ?? outcome.item,
          item: outcome.item,
          context,
        })
      } else {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'delete',
          status: 'committed',
          originalItem: originalItem ?? outcome.item,
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
 * Bracket a write's transaction with the transaction-boundary hooks (#590).
 *
 * Sequence:
 *  1. Run every involved list's `beforeTransaction` in order, tracking which
 *     ran. A throw aborts: the transaction is NEVER opened; `afterTransaction`
 *     fires (status `rolled-back`, with the throw as `error`) ONLY for the lists
 *     whose `beforeTransaction` already ran (symmetric bracket), and the throw
 *     is then re-surfaced.
 *  2. Otherwise open the transaction via `runTransaction` (the existing #569
 *     machinery). On settle (commit or rollback) run `afterTransaction` for
 *     EVERY involved list (all of their `beforeTransaction` ran) with the
 *     outcome.
 *  3. If any `afterTransaction` throws, the rest still run; the collected
 *     errors are surfaced afterward as an {@link AfterTransactionError}.
 *
 * Sudo does not affect these hooks — they always run; sudo only bypasses access.
 */
export async function runWithTransactionBoundary<TPrisma extends PrismaClientLike>(args: {
  involvedLists: InvolvedList[]
  context: AccessContext<TPrisma>
  runTransaction: () => Promise<Record<string, unknown> | null>
}): Promise<Record<string, unknown> | null> {
  const { involvedLists, context, runTransaction } = args

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
    const afterErrors: unknown[] = []
    for (const involved of ran) {
      await runAfterTransactionForList(involved, outcome, context, afterErrors)
    }
    throw beforeError
  }

  // Open the transaction and capture the settle outcome.
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

  // afterTransaction always runs for every list whose beforeTransaction ran
  // (here: all involved lists). All compensators run even if one throws.
  const afterErrors: unknown[] = []
  for (const involved of ran) {
    await runAfterTransactionForList(involved, outcome, context, afterErrors)
  }

  // Surface errors: the transaction's own error takes precedence (the write
  // failed); otherwise any afterTransaction errors.
  if (txError !== undefined) throw txError
  if (afterErrors.length > 0) throw new AfterTransactionError(afterErrors)

  return result
}
