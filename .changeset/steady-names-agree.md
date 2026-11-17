---
'@opensaas/stack-core': patch
'@opensaas/stack-auth': patch
'create-opensaas-app': patch
---

Fix `select()` silently dropping a foreign key the list does not own (#2388), `distinct`/`distinctOn` refusing one it does own (#2389), and an undeclared `createdAt`/`updatedAt` on a list without timestamps being treated as a system field instead of an unknown name (#2390).
