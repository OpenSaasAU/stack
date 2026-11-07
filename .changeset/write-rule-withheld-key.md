---
'@opensaas/stack-core': patch
---

An `update`/`delete` operation rule and a field `update` rule that reach for a relation the write did not deliver now deny instead of reading absence as permission (#2233).
