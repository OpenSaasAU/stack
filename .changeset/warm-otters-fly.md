---
'@opensaas/stack-cli': patch
---

Fix the generated `Context`/`BaseContext` types to derive from core's `StackContext` instead of hand-restating its members, so `context.transaction(...)` now typechecks with no cast and `tx.db.<list>` carries the generated per-list types.
