---
'@opensaas/stack-auth': patch
---

Auth adapter `update` and `incrementOne` now throw `AuthWhereError` on an empty `where` instead of silently no-oping (completes #1980).
