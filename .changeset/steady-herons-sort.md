---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
'create-opensaas-app': patch
---

Fix admin lists emptying on a sort the column cannot take: sorting now follows the ORM's own `order` answer per column, and `orderBy` refuses a virtual or multi-column field as a `ValidationError`.
A failed list read now shows an error state rather than the first-run empty state.
