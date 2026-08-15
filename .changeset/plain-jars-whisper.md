---
'@opensaas/stack-core': patch
---

Fix `checkFieldAccess` granting a field full access when its rule returned a Prisma filter instead of a boolean. Field-level access now returns `boolean` only (`FieldAccessControl`'s type no longer accepts a filter) and a non-boolean result throws `InvalidFieldAccessResultError` instead of silently allowing access.
