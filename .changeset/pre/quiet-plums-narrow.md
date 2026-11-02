---
'@opensaas/stack-core': patch
---

Remove `ListUniqueWhere`, `ListFilterArgs`, `ListWhere`, `ListOrderBy` and `ColumnFilter` — dead exports left over from a `findMany`/`findUnique`-style args surface `update`/`delete` no longer use (they take `ListIdentityWhere`, i.e. `{ id }`, and `findUnique` itself no longer exists).
