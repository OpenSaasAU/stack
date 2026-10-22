---
'@opensaas/stack-auth': patch
---

`deriveAuthLists` now throws when an `extendUserList` field shares a name with a better-auth-derived user field (e.g. `role` with `admin()`), instead of silently dropping its write/read deny. Use `authPlugin({ fieldAccess })` to adjust such a field.
