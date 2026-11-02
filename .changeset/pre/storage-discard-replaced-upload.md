---
'@opensaas/stack-storage': patch
---

Delete the unreferenced new upload when a user `resolveInput` hook retains the previous `file()`/`image()` asset.
