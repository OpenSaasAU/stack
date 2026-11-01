---
'@opensaas/stack-storage': patch
---

Track every upload when two writes in one transaction share a data object, so a rollback removes them all.
