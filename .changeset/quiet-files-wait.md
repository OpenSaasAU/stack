---
'@opensaas/stack-storage': patch
---

`file()`/`image()` with `cleanupOnReplace` now delete the replaced file only after the write commits, and remove the new upload when the write is refused or rolled back.
