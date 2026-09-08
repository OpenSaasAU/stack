---
'@opensaas/stack-core': patch
---

Fix `filterWritableFields` silently dropping a directly-written foreign-key column (`authorId`) instead of writing it, gated by the owning relationship field's write access exactly like `connect`.
