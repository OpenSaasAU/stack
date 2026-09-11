---
'@opensaas/stack-core': minor
---

The nested-write access gap reported in #1384 is closed by refusal, not by gating

Nested `set`, `updateMany` and `deleteMany` under a relationship key used to
reach the database as an unchecked pass-through: the target list's access was
never consulted, no hooks ran, and an unscoped `where` could reach rows well
outside the parent's own subtree. Nested `disconnect` could name a target row
the caller could not read.

Both are closed here by ADR-0050 rather than by per-kind access machinery:
nested relation input leaves the write payload entirely, so `create`, `update`,
`delete`, `connectOrCreate`, `disconnect`, `set`, `updateMany` and `deleteMany`
are all refused with `NestedRelationInputError`. The refusal is unconditional —
`sudo()` does not lift it — which is strictly stronger than the interim
non-sudo-only refusal #1385 shipped on the previous line. Clearing an edge is
now `null` on the relationship field; every other case is a write against the
target list, wrapped in `context.transaction()` when it must land atomically.

See `rugged-terminals-persist.md` for the full write-surface change.
