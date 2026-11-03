---
'@opensaas/stack-storage': patch
---

With `generateUniqueFilenames: false`, `image()` now claims every transformation variant key with the original and refuses a name another row's original or variant already owns; cleanup keeps variants another row still references.
