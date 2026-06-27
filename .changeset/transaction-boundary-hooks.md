---
'@opensaas/stack-core': minor
---

Add `beforeTransaction` / `afterTransaction` transaction-boundary hooks (list- and field-level)

These run OUTSIDE the write's database transaction (in addition to the in-transaction `beforeOperation`/`afterOperation`), for non-transactional side effects like external API calls that must not hold a transaction open and cannot be rolled back. They fire per `(list, operation)` involved in the write (the top-level list plus each nested create/update/delete list) and form a symmetric compensation bracket: `afterTransaction` always runs when its paired `beforeTransaction` ran, receiving the outcome (`status: 'committed' | 'rolled-back'` plus `error` on rollback). On commit it gets the persisted `item` (and `originalItem` for update/delete) **only for the top-level record** — for nested lists these are `undefined`, since the per-record persisted row is not recoverable outside the transaction; use the in-transaction `afterOperation` for per-record nested compensation. On rollback it gets no `item` so it can undo what `beforeTransaction` did. `connectOrCreate` is enumerated as a best-effort create involvement (a resolve-to-connect still fires the bracket with no write), so compensators should be idempotent.

```typescript
list({
  fields: { name: text() },
  hooks: {
    // Runs before the transaction opens.
    beforeTransaction: async ({ operation, inputData }) => {
      await billing.reserveSeat(inputData.seatId)
    },
    // Always runs after the transaction settles.
    afterTransaction: async (args) => {
      if (args.status === 'rolled-back') {
        // The write did not persist (args.error explains why) — compensate.
        await billing.releaseSeat(args.inputData.seatId)
      } else {
        await billing.confirmSeat(args.item.seatId)
      }
    },
  },
})
```

A throwing `beforeTransaction` aborts the write (the transaction never opens) and fires `afterTransaction` (`rolled-back`) only for lists whose `beforeTransaction` already ran. A throwing `afterTransaction` does not stop the other compensators; errors are surfaced afterward. Sudo does not affect these hooks. This is an additive, non-Keystone extension and does not change the existing `beforeOperation`/`afterOperation` semantics.
