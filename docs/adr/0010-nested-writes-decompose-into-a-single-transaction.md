# Nested writes run the full hook pipeline inside one transaction

Status: accepted

To give nested relation writes the same side-effect hooks as top-level writes (issue #569), the Write Pipeline runs every written record's **full** hook pipeline — list- and field-level `beforeOperation`/`afterOperation`, not only `resolveInput`/`validate`/field-rules — for parent **and every nested** `create`/`update`/`delete`, and the whole operation runs inside **one** `prisma.$transaction` so parent and nested writes remain atomic. The transaction's interactive client is threaded through the pipeline as the persistence target, so all writes of one nested operation share the same transaction.

**Realized mechanism (hooks around a single nested persist).** Persistence itself is still performed by Prisma's single nested-write call (so Prisma keeps owning FK ordering and intra-statement atomicity). Around that one persist, the pipeline runs each nested record's `beforeOperation` _before_ the persist and its `afterOperation` _after_ it, all inside the transaction. For nested update/delete the row fetched for access doubles as `originalItem`; for created/updated rows the persisted `item` is recovered by `include`-ing the affected relations in the parent write result. This was chosen over fully decomposing each nested write into its own sequenced `runWritePipeline` run (the higher-fidelity but higher-risk option) precisely because decomposition would force us to re-own the FK ordering Prisma does for free.

## Context

Previously `processNestedOperations` only _transformed_ the payload (running nested `resolveInput`/`validate`/field-rules) and handed the shaped data to one Prisma nested write. There was therefore no per-nested-record point at which `beforeOperation`/`afterOperation` could fire, so side effects (workflows, notifications, billing) silently vanished when a record was written nested instead of top-level — the same logical operation producing different side effects depending on call shape.

## Considered options

- **Hooks around a single nested persist + one transaction (chosen).** Keep Prisma's single nested write for persistence; run each nested record's `beforeOperation` before it and `afterOperation` after it, inside one transaction. True hook parity (every record gets identical before/after hooks regardless of call shape) without re-owning FK ordering. Cost: nested `afterOperation`'s persisted `item` must be recovered from the parent write's `include`d relations, and every write pays for a transaction.
- **Full persistence decomposition.** Pull each nested write into its own `runWritePipeline` run against the transaction client, sequenced by FK ownership. Rejected for #569: highest fidelity but it makes us own the write ordering/FK-linkage Prisma's nested write did for free — more risk than the parity goal warrants. The transaction threading here leaves this open as a later refinement.
- **Post-hoc `afterOperation` only.** Keep the single nested write, walk the result afterward and fire `afterOperation`. Rejected: `beforeOperation` still can't run before nested persistence, so it is only partial parity.
- **Document the limitation.** Declare nested writes hook-partial and recommend top-level writes. Rejected: the PRD's definition-of-done requires nested writes to run the full pipeline.

## Consequences

- **Every write is transactional, not just nested ones.** Uniform semantics were chosen over saving a transaction on single-row writes, so the hook contract below does not depend on whether a write happened to be nested.
- **`afterOperation` throwing now rolls back the write.** Previously (no transaction) the row stayed committed; now it rolls back with the transaction. This is a behavior change, intentional, and more Keystone-correct. (A future explicit `rollback()` helper in hook args may be added as a convenience over throwing.)
- **`beforeOperation`/`afterOperation` are "in-transaction" hooks** — they run inside the transaction and roll back with it, so they are for work atomic with the write, not external calls.
- **Out of scope, deferred to a follow-up:** `beforeTransaction`/`afterTransaction` "transaction-boundary" hooks that run _outside_ the transaction for non-transactional side effects (external API calls), per-list, always-run, receiving the commit/rollback outcome as a compensation bracket. The transaction boundary introduced here is the foundation they build on.
- Relates to ADR-0001 (two-phase read) only at the edge: a write still returns its row through Field Visibility once at the top level; the two-phase _read_ model is unchanged.
