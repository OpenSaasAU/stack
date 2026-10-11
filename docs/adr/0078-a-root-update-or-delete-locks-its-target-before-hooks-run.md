# A root update or delete locks its target before hooks run

Status: accepted

Amends [ADR-0044](0044-a-read-denied-relation-is-omitted-before-the-query.md) and builds on [ADR-0047](0047-a-row-lock-is-an-engine-owned-two-statement-terminal.md).

## Context

ADR-0044 scopes an `UPDATE` by the same Access Filter as its target read. Prisma 8's `update()`/`delete()` do not carry that filter into the statement: they run an unlocked identity `SELECT` and then write keyed on `id` alone. A concurrent commit that moves the row out of scope between the read and the write does not stop the write, and for an item-based rule the window spans the whole hook pipeline (#1803).

## Decision

Inside the write's transaction, before any hook runs, a root `update`/`delete` takes the row lock on its target through the existing lock lane, then resolves the target again under the lock. `originalItem`, item-based access rules and the Access Filter all evaluate against the row as it is while no one else can change it. A row that is gone or no longer in scope resolves to `null` and no hook or write runs.

The pre-transaction gate stays, so a denied write still fires no `beforeTransaction`/`afterTransaction`.

## Consequences

- One extra round trip for the lock and a second target resolution on every root update and delete.
- The lock is taken on the target's identity; scope is checked by the re-resolution, so a write waiting on a row that moved out of scope returns `null` once the lock is granted.
- Isolation levels are unchanged (ADR-0042). Locking rows touched by `connect` reachability checks is out of scope.
- A list with no single-column primary key, and a context whose client cannot compose the lock statement, write without the lock rather than refusing writes that worked before.
