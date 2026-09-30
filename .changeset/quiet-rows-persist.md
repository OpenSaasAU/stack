---
'@opensaas/stack-core': patch
---

`update()` with an empty stored payload now returns the target row and fires `afterOperation`, instead of returning `null`.
