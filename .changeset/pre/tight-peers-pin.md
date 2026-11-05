---
'@opensaas/stack-auth': patch
'@opensaas/stack-ui': patch
'@opensaas/stack-rag': patch
'@opensaas/stack-storage': patch
'@opensaas/stack-tiptap': patch
'@opensaas/stack-storage-s3': patch
'@opensaas/stack-storage-vercel': patch
---

Peer ranges on `@opensaas/stack-core`, `@opensaas/stack-storage` and `@opensaas/stack-ui` now track the release version instead of `^0`, so a mismatched minor is flagged.
