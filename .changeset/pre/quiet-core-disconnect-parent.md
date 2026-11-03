---
'@opensaas/stack-core': patch
---

Clarify the `removeRelated` server action docs: a disconnect that sends `parentId` is the stale-baseline guard, and omitting it disconnects unconditionally.
