---
'@opensaas/stack-core': minor
---

`afterTransaction` now fires when the OUTERMOST transaction a write participates in settles, and can report `status: 'rolled-back'` where it always reported `'committed'` before (ADR-0028, fixes #899).

A write that joins a transaction it did not open — inside `context.transaction()`, or a hook's own `context.db` write — used to fire its `afterTransaction` bracket optimistically as soon as its own write returned, even though the enclosing transaction was still open and could still roll back. It now defers that bracket until the transaction owner (`context.transaction()`, or the Write Pipeline when it opened the transaction) observes the real commit/rollback, then reports the outcome as a conjunction: `committed` if and only if the write itself succeeded **and** the enclosing transaction committed (the write's own error always wins over the transaction's outcome). `beforeTransaction` is unaffected — it still runs eagerly, before its write.

```typescript
User: list({
  hooks: {
    afterTransaction: async ({ status, item, error }) => {
      if (status === 'rolled-back') {
        // Now correctly fires even when this write itself succeeded but the
        // OUTER context.transaction() callback later threw.
        await billing.releaseSeat(error)
      } else {
        await billing.confirmSeat(item.seatId)
      }
    },
  },
})
```

Three behavior changes to be aware of when upgrading:

- A `context.transaction()` call can now **reject** with `AfterTransactionError` even after its underlying transaction already committed, if a deferred `afterTransaction` hook throws. A transaction/serialization error (e.g. `P2034`) still takes precedence and propagates unwrapped, so an existing `P2034` retry loop is unaffected.
- The deferred `item` a joined write's `afterTransaction` receives on commit is the row **as that write persisted it**, captured at write time — not re-read at flush — so it can be stale if a later write in the same transaction touches the same record.
- Transaction-boundary hooks (`beforeTransaction`/`afterTransaction`) on a joined write now always receive a context bound to the base client, never the transaction client — matching what top-level writes already did.

A write with no transaction owner at all (an app-managed `prisma.$transaction`, or a client that cannot open one, e.g. a bare test mock) is unaffected and still fires `afterTransaction` optimistically at write time.

See `docs/adr/0028-a-transaction-boundary-hook-reports-the-outermost-transaction.md` and the "In-transaction vs transaction-boundary hooks" section of the hooks concept doc.
