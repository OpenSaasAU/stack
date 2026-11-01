---
'@opensaas/stack-core': patch
---

`generate` now refuses any stored column whose physical name (`db.map` or `db.foreignKey.map`) equals a relation field name on the same list, closing a path that leaked a related row past its read rules.
