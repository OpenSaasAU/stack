---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Fix relationship picker search redirecting away from the edit form: the `relationshipOptions` server action now returns `{ options }` instead of `{ success, data }`. Upgrade `@opensaas/stack-core` and `@opensaas/stack-ui` together.
