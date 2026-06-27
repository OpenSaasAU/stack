# Nested writes decompose into per-record pipeline runs inside one transaction

Status: accepted

To give nested relation writes the same side-effect hooks as top-level writes (issue #569), the Write Pipeline no longer folds nested create/update/delete into the parent's single Prisma nested-write call. Instead each written record — parent and every nested record — runs the **full** Write Pipeline (including `beforeOperation`/`afterOperation`), and the whole operation runs inside **one** `prisma.$transaction` so parent and nested writes remain atomic. The transaction's interactive client is threaded through the pipeline as the persistence target, so all writes of one nested operation share the same transaction.

## Context

Previously `processNestedOperations` only *transformed* the payload (running nested `resolveInput`/`validate`/field-rules) and handed the shaped data to one Prisma nested write. There was therefore no per-nested-record persistence point at which `beforeOperation`/`afterOperation` could fire, so side effects (workflows, notifications, billing) silently vanished when a record was written nested instead of top-level — the same logical operation producing different side effects depending on call shape.

## Considered options

- **Decompose + one transaction (chosen).** True Keystone parity; every record gets identical hooks regardless of call shape. Cost: we now own write ordering/FK-linkage that Prisma's nested write did for free, and every write pays for a transaction.
- **Post-hoc `afterOperation` only.** Keep the single nested write, walk the result afterward and fire `afterOperation`. Rejected: `beforeOperation` still can't run before nested persistence, so it is only partial parity.
- **Document the limitation.** Declare nested writes hook-partial and recommend top-level writes. Rejected: the PRD's definition-of-done requires nested writes to run the full pipeline.

## Consequences

- **Every write is transactional, not just nested ones.** Uniform semantics were chosen over saving a transaction on single-row writes, so the hook contract below does not depend on whether a write happened to be nested.
- **`afterOperation` throwing now rolls back the write.** Previously (no transaction) the row stayed committed; now it rolls back with the transaction. This is a behavior change, intentional, and more Keystone-correct. (A future explicit `rollback()` helper in hook args may be added as a convenience over throwing.)
- **`beforeOperation`/`afterOperation` are "in-transaction" hooks** — they run inside the transaction and roll back with it, so they are for work atomic with the write, not external calls.
- **Out of scope, deferred to a follow-up:** `beforeTransaction`/`afterTransaction` "transaction-boundary" hooks that run *outside* the transaction for non-transactional side effects (external API calls), per-list, always-run, receiving the commit/rollback outcome as a compensation bracket. The transaction boundary introduced here is the foundation they build on.
- Relates to ADR-0001 (two-phase read) only at the edge: a write still returns its row through Field Visibility once at the top level; the two-phase *read* model is unchanged.
