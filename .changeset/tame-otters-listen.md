---
'@opensaas/stack-auth': patch
---

Add a test that compares the derived Auth lists against better-auth's own `getAuthTables()` definitions, failing the build on future upstream schema drift instead of relying on a human to notice.
