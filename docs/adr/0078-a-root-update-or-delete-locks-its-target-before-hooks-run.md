# A root update or delete locks its target before hooks run

Status: accepted

Amends [ADR-0044](0044-a-read-denied-relation-is-omitted-before-the-query.md) and builds on [ADR-0047](0047-a-row-lock-is-an-engine-owned-two-statement-terminal.md).

## Context

ADR-0044 scopes an `UPDATE` by the same Access Filter as its target read. Prisma 8's `update()`/`delete()` do not carry that filter into the statement: they run an unlocked identity `SELECT` and then write keyed on `id` alone. A concurrent commit that moves the row out of scope between the read and the write does not stop the write, and for an item-based rule the window spans the whole hook pipeline (#1803).

## Decision

Inside the write's transaction, before any hook runs, a root `update`/`delete` takes the row lock on its target through the existing lock lane, then resolves the target again under the lock. `originalItem`, item-based access rules and the Access Filter all evaluate against the row as it is while no one else can change it. A row that is gone or no longer in scope resolves to `null` and no hook or write runs.

The pre-transaction gate stays, so a denied write still fires no `beforeTransaction`/`afterTransaction`.

### Lock strength

A root `update` takes `FOR NO KEY UPDATE`; a root `delete` takes `FOR UPDATE`. The public `.forUpdate()` stays `FOR UPDATE` (ADR-0047).

The first version of this decision took `FOR UPDATE` for both, and that deadlocked a common shape (#2157). A child `INSERT` takes `FOR KEY SHARE` on its parent through the foreign-key check, and `FOR UPDATE` conflicts with `FOR KEY SHARE`, so transactions that had each inserted a child and then updated the parent each waited on the others. `FOR NO KEY UPDATE` is the lock a plain `UPDATE` takes anyway and is compatible with `FOR KEY SHARE`.

The mutex this record depends on still holds, because `FOR NO KEY UPDATE` conflicts with itself and with `FOR UPDATE`: two root updates serialise, and a root update excludes a root delete and a `.forUpdate()`. `FOR KEY SHARE` changes nothing on the row, so `originalItem` stays current while the lock is held. A root delete keeps the stronger lock because the `DELETE` takes it regardless, and taking a weaker one first would only add an upgrade.

Strength is a closed set the engine picks at each call site. It travels as a required argument through the lock lane and selects from a fixed table of clause text, so nothing else can reach the statement, and no method of the secured surface takes it.

### What the weaker lock costs

`FOR NO KEY UPDATE` is a trade, not a pure fix. It lets a racer's child `INSERT` through while a root update holds its target, and that racer then holds `FOR KEY SHARE` on the row. A transaction that holds the root update's lock and goes on to need `FOR UPDATE` on the same row now deadlocks against a racer that inserts a child and then updates the parent. **This did not happen when a root update took `FOR UPDATE`**, because the racer parked at its `INSERT`. It is a regression, accepted because the shape #2157 fixes is common and these are rarer, and because the failure is a clean rollback rather than bad data.

Measured through the engine on Postgres 14. T1 is the transaction below, and T2 inserts a child and then updates the parent, arriving once T1 holds its lock:

| T1                                                                                         | `FOR NO KEY UPDATE` (this decision) | `FOR UPDATE` (the first version)  | Update's engine lock removed |
| ------------------------------------------------------------------------------------------ | ----------------------------------- | --------------------------------- | ---------------------------- |
| Root update, then `.forUpdate()` on the row                                                | `deadlock detected`                 | OK                                | `deadlock detected`          |
| Root update, then root delete of the row                                                   | `deadlock detected`                 | No deadlock; T2 gets its FK error | `deadlock detected`          |
| `.forUpdate()` on the row inside its own update hook                                       | `deadlock detected`                 | OK                                | OK                           |
| Update changing a unique column, T2 arriving in the hook window                            | `deadlock detected`                 | OK                                | OK                           |
| `connect` changing a one-to-one owner's unique foreign key, T2 arriving in the hook window | `deadlock detected`                 | OK                                | OK                           |
| Control: update changing neither, T2 arriving in the hook window                           | OK                                  | OK                                | OK                           |

The two unique-column rows need no `.forUpdate()` from anyone. Postgres escalates an `UPDATE` of a column with a unique index to `FOR UPDATE` by itself, so the write upgrades its own lock when its statement runs. The exposure is the whole hook window, from the engine lock to that statement: on the first version a racer arriving there parked at its `INSERT`, and with no engine lock at all it would have finished first. The engine cannot pick a stronger lock for these writes, because it locks before hooks have settled the payload.

What each side can do:

- **Update then `.forUpdate()` or delete, and the unique-column updates:** take `.forUpdate()` on the row before the update, in a `context.transaction`. That holds whether or not the racer has already inserted.
- **`.forUpdate()` inside the row's own update hook has no fix on its own side**, because the engine lock is taken before any hook runs. The only fix is on the racer's side: every path that inserts a child takes `.forUpdate()` on the parent first.
- **Either way, a caller can retry.** The loser rolls back whole. Until #2158 lands it reaches the caller as a generic `DatabaseError` with `deadlock detected` on `cause`, so `isSerializationFailure` does not match it and a retry loop has to inspect the `cause`; #2158 is what gives it a retryable classification.

## Consequences

- One extra round trip for the lock and a second target resolution on every root update and delete.
- The lock is taken on the target's identity; scope is checked by the re-resolution, so a write waiting on a row that moved out of scope returns `null` once the lock is granted.
- Isolation levels are unchanged (ADR-0042). Locking rows touched by `connect` reachability checks is out of scope.
- A list with no single-column primary key, and a context whose client cannot compose the lock statement, write without the lock rather than refusing writes that worked before.
- A root update no longer holds off a concurrent child `INSERT`. A rule that depends on a parent's children not changing during an update takes `.forUpdate()` on the parent before the update and on every path that inserts a child. Taking it inside the row's own update hook is the case above with no fix on its own side.
- Inserting a child and then taking `.forUpdate()` on its parent has the same deadlock this record fixed for root updates, and stays. Take the lock before the insert, which is the order the capacity gate already uses. Whether `.forUpdate()` should weaken is a separate question.
- The #2157 shape itself still deadlocks when the racers change a unique column, since each `UPDATE` escalates against the other's `FOR KEY SHARE`.
- A `first()` in a hook followed by an `update` computed from it is an application-level lost update: the read is not under the lock. `item` in `resolveInput` is read under it.
