---
'@opensaas/stack-storage': patch
---

`uploadImage` now deletes the original and already-uploaded variants when a later transformation or upload fails, instead of orphaning them in storage.
