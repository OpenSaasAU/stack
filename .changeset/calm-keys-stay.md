---
'@opensaas/stack-core': patch
---

A caller's own `where()` on a to-one include no longer nulls the parent's foreign key. The column is narrowed on access grounds alone.
