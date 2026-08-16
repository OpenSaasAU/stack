---
'@opensaas/stack-auth': patch
---

`getSessionFromAuth()` now accepts an auth instance from either `createAuth()` overload — including the plugin-narrowed one — without a cast.
