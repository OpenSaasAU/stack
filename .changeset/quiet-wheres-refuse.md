---
'@opensaas/stack-auth': patch
---

The Auth adapter's `findOne`, `delete` and `consumeOne` now throw `AuthWhereError` on an empty `where` instead of acting on an arbitrary row.
