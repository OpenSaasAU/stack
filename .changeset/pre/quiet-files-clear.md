---
'@opensaas/stack-storage': patch
---

Fix `cleanupOnReplace` not removing the old file or image (and its variants) when the field is cleared with `null`; the asset is removed only after the write commits.
