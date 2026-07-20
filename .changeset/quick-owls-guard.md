---
'@opensaas/stack-core': patch
---

Harden `createRelated` server action: reject malformed calls that supply only one of `field`/`parentId`, and validate that the back-reference names a relationship field before injecting the parent connect.
