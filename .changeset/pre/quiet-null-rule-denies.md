---
'@opensaas/stack-core': patch
---

An access rule returning `null` or `undefined` now denies instead of throwing a raw `TypeError`, so reads of unrelated lists no longer break.
