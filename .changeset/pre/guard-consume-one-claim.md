---
'@opensaas/stack-auth': patch
---

Auth adapter `consumeOne` now re-applies the caller's `where` on the claiming DELETE, so a row that changed between the SELECT and DELETE is no longer claimed.
