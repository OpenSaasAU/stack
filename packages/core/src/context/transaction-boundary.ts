import type { ListConfig, OpenSaasConfig } from '../config/types.js'
import type { AccessContext } from '../access/types.js'
import {
  executeBeforeTransaction,
  executeAfterTransaction,
  executeFieldBeforeTransactionHooks,
  executeFieldAfterTransactionHooks,
  type TransactionOutcome,
} from '../hooks/index.js'
import type { WriteOperation } from './write-pipeline.js'
import type {
  AfterTransactionFailure,
  TransactionRegistry,
  TransactionSettleOutcome,
} from '../access/transaction-registry.js'

/**
 * Transaction-boundary hooks (#590 / ADR-0010): `beforeTransaction`/`afterTransaction`
 * bracket a write's `$transaction` from the outside, for non-transactional side
 * effects. See ADR-0010 for the bracket's design and ADR-0028 for how a joined
 * write's `afterTransaction` defers to the transaction owner.
 */

/** One list involved in a write, and the row the bracket reports on. */
export interface InvolvedList {
  listKey: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  operation: WriteOperation
  /** `undefined` for delete, which has no input payload. */
  inputData: Record<string, unknown> | undefined
  originalItem: Record<string, unknown> | undefined
}

/**
 * Enumerate the lists involved in a write. A payload carries this list's own
 * scalars and nothing that writes another list, so the answer is always the
 * one list (ADR-0050); the shape stays a list because the bracket, the
 * deferral queue and `runAfterTransactionForList` are all written over a set.
 */
export function enumerateInvolvedLists(args: {
  listName: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
  listConfig: ListConfig<any>
  operation: WriteOperation
  inputData: Record<string, unknown> | undefined
  /** The existing row for update/delete, resolved before the transaction by the caller. */
  originalItem: Record<string, unknown> | undefined
}): InvolvedList[] {
  const { listName, listConfig, operation, inputData, originalItem } = args
  return [
    {
      listKey: listName,
      listConfig,
      operation,
      inputData,
      originalItem,
    },
  ]
}

/** Runs one involved list's `beforeTransaction` hooks. A throw propagates to the caller (which aborts the write). */
async function runBeforeTransactionForList(
  involved: InvolvedList,
  context: AccessContext,
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
export async function runAfterTransactionForList(
  involved: InvolvedList,
  outcome: TransactionOutcome,
  context: AccessContext,
  errors: AfterTransactionFailure[],
): Promise<void> {
  const { listKey, listConfig, operation, inputData, originalItem } = involved
  const fail = (error: unknown): void => {
    errors.push({ error, status: outcome.status, listKey, operation })
  }

  try {
    if (outcome.status === 'committed') {
      const committedItem = outcome.item
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
          originalItem,
          item: committedItem,
          context,
        })
      } else {
        await executeAfterTransaction(listConfig.hooks, {
          listKey,
          operation: 'delete',
          status: 'committed',
          originalItem,
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
    fail(err)
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
    fail(err)
  }
}

/**
 * The reason an `afterTransaction` bracket reports `rolled-back` for a write
 * whose transaction did commit: the write's own predicate matched no row, so
 * nothing was written and there is nothing for a compensator to act on. Never
 * thrown to the caller — the terminal answers `null`, denied-or-gone, as it
 * does for every other no-write outcome.
 */
export class WriteMatchedNothingError extends Error {
  constructor(readonly listKeys: readonly string[]) {
    super(
      `The write on ${listKeys.map((key) => `"${key}"`).join(', ')} matched no row, so nothing ` +
        `was written.`,
    )
    this.name = 'WriteMatchedNothingError'
  }
}

/**
 * Hands each failed `afterTransaction` hook to the configured
 * `onAfterTransactionError`, or to `console.error` when none is set or the
 * callback itself throws. Never throws: the write's outcome is already final.
 */
export async function reportAfterTransactionFailures(
  config: OpenSaasConfig,
  failures: readonly AfterTransactionFailure[],
): Promise<void> {
  for (const report of failures) {
    const callback = config.onAfterTransactionError
    if (callback !== undefined) {
      try {
        await callback(report)
        continue
      } catch (callbackError) {
        console.error(
          'onAfterTransactionError threw while reporting an afterTransaction failure:',
          callbackError,
        )
      }
    }
    console.error(
      `afterTransaction hook for ${report.listKey}.${report.operation} threw ` +
        `(${report.status}); the write's outcome is unchanged:`,
      report.error,
    )
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
 * `afterTransaction` errors never change the write's outcome: they go to
 * {@link reportAfterTransactionFailures} (ADR-0074).
 *
 * Sudo bypasses access control only — never these hooks.
 */
export async function runWithTransactionBoundary(args: {
  config: OpenSaasConfig
  involvedLists: InvolvedList[]
  /**
   * The context `beforeTransaction` runs with — unchanged from what the
   * write itself was issued through. Left as-is deliberately: `beforeTransaction`
   * is eager, so on a joined write it already runs while the enclosing
   * transaction is open, same as it always has; issue #1348 is about the
   * DEFERRED hook reaching a transaction that has since closed, not about
   * this one, and giving it a base-client context instead would newly expose
   * every joined `beforeTransaction` to the single-connection-pool contention
   * ADR-0028 already documents as a `context.transaction()` hazard, for no
   * problem it currently has.
   */
  context: AccessContext
  /**
   * The context `afterTransaction` runs with — the same session/sudo/plugins
   * as `context` (so `tx.sudo()`/`tx.withSession()` still elevates a joined
   * write's own compensator), but rebound to the BASE client (ADR-0028): a
   * compensating write must survive a transaction that may already be closed
   * by flush time. Resolved once by the caller via
   * `resolveAfterTransactionContext` (issue #1348).
   */
  afterTransactionContext: AccessContext
  /** Set when this write is nested in a transaction it did not open (ADR-0028). */
  joinedOwner?: TransactionRegistry
  /** Set when this write just opened the transaction joined writes below it share. */
  ownedRegistry?: TransactionRegistry
  runTransaction: () => Promise<Record<string, unknown> | null>
}): Promise<Record<string, unknown> | null> {
  const {
    config,
    involvedLists,
    context,
    afterTransactionContext,
    joinedOwner,
    ownedRegistry,
    runTransaction,
  } = args

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
      joinedOwner.enqueue(async (_settle, errors) => {
        for (const involved of ran) {
          await runAfterTransactionForList(involved, outcome, afterTransactionContext, errors)
        }
      })
    } else {
      const afterErrors: AfterTransactionFailure[] = []
      for (const involved of ran) {
        await runAfterTransactionForList(involved, outcome, afterTransactionContext, afterErrors)
      }
      await reportAfterTransactionFailures(config, afterErrors)
    }
    const owner = joinedOwner ?? ownedRegistry
    owner?.poison(beforeError)
    throw beforeError
  }

  // Open (or join) the transaction and capture this write's own settle outcome.
  let outcome: TransactionOutcome
  let result: Record<string, unknown> | null = null
  let txError: unknown
  try {
    result = await runTransaction()
    // `null` is the write that did not happen — its predicate matched no row.
    // The transaction still commits (a joined write below it may well have
    // persisted), but this bracket must not tell its own list's compensator
    // that a write committed when none did.
    outcome =
      result === null
        ? {
            status: 'rolled-back',
            error: new WriteMatchedNothingError(involvedLists.map((involved) => involved.listKey)),
          }
        : { status: 'committed', item: result }
  } catch (err) {
    txError = err
    outcome = { status: 'rolled-back', error: err }
    ;(joinedOwner ?? ownedRegistry)?.poison(err)
  }

  if (joinedOwner) {
    // Deferred (ADR-0028) — only afterTransaction waits; this write's own
    // result/throw is returned/thrown normally below.
    joinedOwner.enqueue(async (settle, errors) => {
      const finalOutcome = resolveDeferredOutcome(outcome, settle)
      for (const involved of ran) {
        await runAfterTransactionForList(involved, finalOutcome, afterTransactionContext, errors)
      }
    })
    if (txError !== undefined) throw txError
    return result
  }

  // All compensators run even if one throws.
  const afterErrors: AfterTransactionFailure[] = []
  for (const involved of ran) {
    await runAfterTransactionForList(involved, outcome, afterTransactionContext, afterErrors)
  }

  // Owner: drain joined writes' deferred brackets with this write's own settle
  // outcome (ADR-0028).
  try {
    if (ownedRegistry) {
      const settle: TransactionSettleOutcome =
        txError !== undefined ? { status: 'rolled-back', error: txError } : { status: 'committed' }
      await ownedRegistry.drain(settle, afterErrors)
    }
  } finally {
    await reportAfterTransactionFailures(config, afterErrors)
  }

  if (txError !== undefined) throw txError

  return result
}
