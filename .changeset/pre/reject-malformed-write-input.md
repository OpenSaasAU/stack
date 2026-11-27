---
'@opensaas/stack-core': patch
---

`create`/`update` now throw `ValidationError` when `data` isn't an object, and a list `resolveInput` returning a non-object is rejected instead of silently dropping the payload.
