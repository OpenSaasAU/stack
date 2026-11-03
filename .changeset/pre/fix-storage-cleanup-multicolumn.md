---
'@opensaas/stack-storage': patch
---

Fix `cleanupOnReplace` and `cleanupOnDelete` never firing for `file()`/`image()` fields in multi-column (`columns: 'keystone'`) mode.
