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
 * Transaction-boundary hooks (#590 / ADR-0010): `beforeTransaction`/`afterTransaction`
 * bracket a write's `$transaction` from the outside, for non-transactional side
 * effects. See ADR-0010 for the bracket's design and ADR-0028 for how a joined
 * write's `afterTransaction` defers to the transaction owner.
 */

/**
 * One list involved in a write, enumerated purely from the input tree (no DB
 * reads). `item`/`originalItem` are populated only for the top-level record
 * (`isTopLevel`) — a nested list's persisted row isn't reliably recoverable
 * outside the transaction, so handing it the top-level row instead would be
 * silently wrong.
 */
export interface InvolvedList {
  listKey: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  operation: WriteOperation
  isTopLevel: boolean
  /** `undefined` for delete, which has no input payload. */
  inputData: Record<string, unknown> | undefined
  originalItem: Record<string, unknown> | undefined
}

const NESTED_OP_OPERATIONS: ReadonlyArray<{ kind: string; operation: WriteOperation }> = [
  { kind: 'create', operation: 'create' },
  { kind: 'update', operation: 'update' },
  { kind: 'delete', operation: 'delete' },
  // connectOrCreate's create branch may create; treat as a possible create involvement.
  { kind: 'connectOrCreate', operation: 'create' },
]

const DISTINCT_OPERATION_COUNT = new Set(NESTED_OP_OPERATIONS.map((o) => o.operation)).size

function isRelationshipField(fieldConfig: FieldConfig | undefined): boolean {
  return fieldConfig?.type === 'relationship'
}

/**
 * Distinct (listKey, operation) pairs reachable from `startListName` via the
 * CONFIG's relationship graph (not the payload) — the saturation bound
 * `walkNested` stops at once it has recorded this many. Bounding by reachable
 * pairs rather than a depth cap (#835) avoids losing hooks for payloads
 * nested deeper than any fixed cap, while still terminating promptly on
 * payloads that repeat the same few lists.
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

/** Extract a nested-op entry's create/update payload so its `beforeTransaction` receives meaningful `inputData`. */
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
 * {@link InvolvedList} per nested create/update/delete involvement. De-dups
 * by (listKey, operation): these hooks are a per-LIST compensation bracket,
 * not per-record, so a list with many nested records of the same operation
 * fires its bracket once.
 */
function walkNested(
  data: Record<string, unknown> | undefined,
  fieldConfigs: Record<string, FieldConfig>,
  config: OpenSaasConfig,
  out: InvolvedList[],
  seen: Set<string>,
  maxPairs: number,
): void {
  // Saturated: no further pair can be new (see countReachableInvolvementPairs).
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

      for (const entry of entries) {
        const childData = nestedInputData(kind, entry)
        walkNested(childData, relatedListConfig.fields, config, out, seen, maxPairs)
      }
    }
  }
}

/**
 * Enumerate the lists involved in a write — the top-level list plus every
 * nested create/update/delete target — without DB reads. The top-level list
 * is always first.
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

  walkNested(inputData, listConfig.fields, config, out, seen, maxPairs)

  return out
}

/** Runs one involved list's `beforeTransaction` hooks. A throw propagates to the caller (which aborts the write). */
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
 * Runs one involved list's `afterTransaction` hooks against the settled
 * {@link TransactionOutcome}, collecting rather than throwing errors so the
 * caller can keep running the remaining lists' compensators. Exported for
 * {@link TransactionRegistry} to reuse when draining a deferred, joined
 * write's bracket (ADR-0028).
 */
export async function runAfterTransactionForList<TPrisma extends PrismaClientLike>(
  involved: InvolvedList,
  outcome: TransactionOutcome,
  context: AccessContext<TPrisma>,
  errors: unknown[],
): Promise<void> {
  const { listKey, listConfig, operation, isTopLevel, inputData, originalItem } = involved

  // The persisted row (`outcome.item`) is the TOP-LEVEL row only. Handing it to
  // a nested list's hook would silently mis-type as that list's own item — for
  // nested lists `item`/`originalItem` stay `undefined`; per-record nested
  // compensation belongs in the in-transaction `afterOperation`, which gets the
  // correct row.
  try {
    if (outcome.status === 'committed') {
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
 * Resolves a joined write's final outcome once the owner's settle is known
 * (ADR-0028): the write's own error always wins; otherwise committed iff the
 * owner's transaction also committed.
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
 * Brackets a write's transaction with the transaction-boundary hooks (#590,
 * ADR-0028 / #899): runs every involved list's `beforeTransaction` eagerly —
 * a throw here aborts before `runTransaction` (#569) ever opens the write's
 * transaction — then routes `afterTransaction` by ownership: deferred onto
 * `args.joinedOwner`'s {@link TransactionRegistry} for a joined write, run
 * eagerly (draining `args.ownedRegistry`) for the write that opened the
 * transaction, or run eagerly with neither set. See ADR-0028 for why. A
 * joined write's `afterTransaction` errors therefore surface as an
 * {@link AfterTransactionError} from the OWNER's promise, not this write's.
 *
 * Sudo bypasses access control only — never these hooks.
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

  // A list counts as "ran" the moment its beforeTransaction BEGINS (pushed
  // before the try below), not on success — so a list whose beforeTransaction
  // itself throws still gets its afterTransaction, in case it took a partial
  // external action that needs compensating.
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

  // Abort path: never open the transaction; compensate the lists that ran,
  // then rethrow the original error.
  if (beforeError !== undefined) {
    const outcome: TransactionOutcome = { status: 'rolled-back', error: beforeError }
    if (joinedOwner) {
      // Discards any afterTransaction errors on this path — only beforeError
      // propagates, matching the eager branch below.
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

  // Open (or join) the transaction and capture this write's own settle outcome.
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
    // Deferred (ADR-0028) — only afterTransaction waits; this write's own
    // result/throw is returned/thrown normally below.
    joinedOwner.enqueue(async (settle, errors) => {
      const finalOutcome = resolveDeferredOutcome(outcome, settle)
      for (const involved of ran) {
        await runAfterTransactionForList(involved, finalOutcome, context, errors)
      }
    })
    if (txError !== undefined) throw txError
    return result
  }

  // All compensators run even if one throws.
  const afterErrors: unknown[] = []
  for (const involved of ran) {
    await runAfterTransactionForList(involved, outcome, context, afterErrors)
  }

  // Owner: drain joined writes' deferred brackets with this write's own settle
  // outcome (ADR-0028).
  if (ownedRegistry) {
    const settle: TransactionSettleOutcome =
      txError !== undefined ? { status: 'rolled-back', error: txError } : { status: 'committed' }
    await ownedRegistry.drain(settle, afterErrors)
  }

  // Transaction error takes precedence over afterTransaction errors (ADR-0028).
  if (txError !== undefined) throw txError
  if (afterErrors.length > 0) throw new AfterTransactionError(afterErrors)

  return result
}
