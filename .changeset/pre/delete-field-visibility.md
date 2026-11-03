---
'@opensaas/stack-core': patch
---

Fix `delete` returning the raw deleted row: read-denied fields and password hashes are now filtered like create/update results.
