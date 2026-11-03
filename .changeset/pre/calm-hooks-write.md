---
'@opensaas/stack-core': patch
---

Field-level `create`/`update` access now gates the keys the caller supplied, so a list's own `resolveInput` can set a field callers may not write.
