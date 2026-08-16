/**
 * Deferral registry for transaction-boundary hooks on a JOINED write (ADR-0028,
 * issue #899).
 *
 * A write that joins a transaction it did not open — because the client it was
 * handed exposes no way to open one (a Prisma transaction client, or a plain
 * write issued from a hook whose context is rebound to one) — cannot itself
 * observe when the enclosing transaction settles. Instead of firing
 * `afterTransaction` optimistically at write time, it enqueues a flush here.
 * The transaction owner (`context.transaction()`, or the Write Pipeline when it
 * actually opens the transaction) drains the queue, in enqueue (write) order,
 * once it observes its own transaction settle — supplying the real
 * committed/rolled-back outcome.
 *
 * This is internal plumbing with no public surface: it is threaded through the
 * same context-rebind path ADR-0010/0012 already use for `plugins` and
 * `_resolveOutputChain` (see `AccessContext['_transactionOwner']`), never
 * exposed on the public `StackContext` type.
 */

/**
 * The outcome the transaction OWNER observed for the transaction as a whole —
 * distinct from a single write's own {@link import('../hooks/index.js').TransactionOutcome},
 * which additionally carries that write's own persisted `item` or `error`.
 */
export interface TransactionSettleOutcome {
  status: 'committed' | 'rolled-back'
  error?: unknown
}

/**
 * One deferred write's flush: given the owner's settle outcome, runs that
 * write's `afterTransaction` bracket and appends any hook errors to `errors`.
 */
export type QueuedTransactionFlush = (
  settle: TransactionSettleOutcome,
  errors: unknown[],
) => Promise<void>

/**
 * A FIFO queue of deferred transaction-boundary flushes, owned by whichever
 * component opened the enclosing transaction. One registry per owned
 * transaction; a nested `context.transaction()` joins its enclosing owner's
 * registry rather than creating a second one.
 */
export class TransactionRegistry {
  private readonly queue: QueuedTransactionFlush[] = []

  enqueue(flush: QueuedTransactionFlush): void {
    this.queue.push(flush)
  }

  /** Run every queued flush, in enqueue order, against the settled outcome. */
  async drain(settle: TransactionSettleOutcome, errors: unknown[]): Promise<void> {
    for (const flush of this.queue) {
      await flush(settle, errors)
    }
  }
}
