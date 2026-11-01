---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'@opensaas/stack-ui': patch
'@opensaas/stack-auth': patch
'@opensaas/stack-rag': patch
'@opensaas/stack-storage': patch
'@opensaas/stack-storage-s3': patch
'@opensaas/stack-storage-vercel': patch
'@opensaas/stack-tiptap': patch
'create-opensaas-app': patch
---

Add a `typecheck` script to every package, covering `tests/**/*` alongside `src/**/*` (not just what `build` compiles), and fix the type errors it surfaced in existing test files.
