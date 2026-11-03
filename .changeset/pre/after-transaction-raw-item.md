---
'@opensaas/stack-core': patch
---

`afterTransaction`'s `item` is now the raw persisted row, matching `originalItem` and `afterOperation`, instead of the caller's Field Visibility projection. The caller's return value is still projected.
