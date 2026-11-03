---
'@opensaas/stack-core': patch
---

`isRequired` on `integer`, `decimal`, `bigInt` and `select` now rejects `null` on update with a field error instead of reaching the database.
