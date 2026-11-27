---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

Fix part columns of a multi-column field without `assembleColumns` reaching a session the field's own `read` rule denies.
