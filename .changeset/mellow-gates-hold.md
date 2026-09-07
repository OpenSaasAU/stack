---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Add the row lock and the advisory lock to the transaction-bound context

A capacity gate is the case a stricter isolation level used to cover, and `context.transaction(fn)` no longer takes one. `.forUpdate()` is the replacement: a row lock on the contended parent, taken **before** the count, so every racer takes the same token on the same row and the count cannot go stale under a booking a racer that got there first has already committed.

```typescript
const result = await context.transaction(async (tx) => {
  // The lock comes BEFORE the count. `null` here is denied-or-gone — either
  // way there is no gate to run.
  const slot = await tx.db.Slot.where({ id: { equals: slotId } })
    .forUpdate()
    .first()
  if (slot === null) return { booked: false }

  const { taken } = await tx.db.Booking.where({ slotId: { equals: slotId } }).aggregate(
    (aggregate) => ({ taken: aggregate.count() }),
  )
  if (taken >= slot.capacity) return { booked: false }

  return { booked: true, item: await tx.db.Booking.create({ data: { slotId, holder } }) }
})
```

`.forUpdate()` is on the transaction-bound builder and nowhere else. A lock taken outside a transaction is released at the end of the statement that took it, so it would compile, run, return rows and guard nothing — `context.db.Slot.forUpdate()` is a compile error rather than a throw. The generated bundle names two faces per list for it, `SlotList` and `SlotTxList`, and `TransactionContext` is the context over the locking one.

The terminal runs two statements. The scoped read goes first and resolves operation access, the Access Filter and Field Visibility exactly as any read does; the engine then composes `SELECT <pk> FROM <table> WHERE <pk> IN ($1…$n) ORDER BY <pk> LIMIT $n+1 FOR UPDATE` over the keys it returned and runs it on the transaction's own connection. So the locked set is provably a subset of the readable set, and **a terminal never returns a row it did not lock**: a row deleted between the two statements locks nothing, `first()` yields `null` and `all()` the surviving subset. `null` now means denied-or-vanished.

`first()` and `all()` carry the modifier. `aggregate()` and `nearest()` refuse it rather than drop it — an aggregate returns no primary keys to lock, and a ranking is not a gate. There is no `forShare`, no `NOWAIT` and no `SKIP LOCKED`: a skipped locked row would be indistinguishable from an access-denied one, which would make silent failure mean two things at once. The engine always emits `ORDER BY <pk>`, so acquisition order is the same in every session.

A list whose table has no single-column primary key cannot be locked (`RowLockIdentityError`), and one terminal binds at most `ROW_LOCK_MAX_KEYS` keys (`RowLockKeyLimitExceededError`) — a cost limit, fail-closed, well under Postgres's bind-parameter ceiling, where the failure is a corrupted bind rather than a clean refusal.

`tx.advisoryLock(key)` joins it on the transaction context, for an invariant that is not a row:

```typescript
await context.transaction(async (tx) => {
  await tx.advisoryLock(`checkout:${cartId}`)
  // …
})
```

It runs `pg_advisory_xact_lock(hashtext($1))` and releases when the transaction ends, whichever way it ends. It sits on the context rather than on `db` because it locks a number and belongs to no list. `hashtext` is 32-bit, so two distinct keys can collide — a collision costs spurious serialisation, never a missed lock.

See ADR-0047 and ADR-0062.
