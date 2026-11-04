---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Apply `db.defaults.timestamp` to the auto `updatedAt` as well as `createdAt`, so auth lists no longer plan a type change on `updatedAt`. Adopting a database drops the `updatedAt` database default; see the config reference.
