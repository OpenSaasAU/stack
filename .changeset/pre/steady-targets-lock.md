---
'@opensaas/stack-core': patch
---

A root `update`/`delete` now locks its target row before hooks run and re-resolves it under the lock, so a concurrent change that moves the row out of access scope returns `null` instead of writing.
