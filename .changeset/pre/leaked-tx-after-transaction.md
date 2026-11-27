---
'@opensaas/stack-core': patch
---

Fix a write through a leaked transaction context firing `beforeTransaction` but never `afterTransaction`; a flush enqueued after the registry drained now runs immediately with the rolled-back outcome.
