---
'@opensaas/stack-core': patch
---

Fix `forUpdate()` returning stale or no-longer-accessible rows: locked rows are now re-read under the Access Filter after the lock is taken.
