---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
'create-opensaas-app': patch
---

Fix relationship picker search redirecting away from the edit form: the `relationshipOptions` server action now returns `{ options }` instead of `{ success, data }`.
