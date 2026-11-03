---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'@opensaas/stack-auth': patch
'@opensaas/stack-ui': patch
'@opensaas/stack-storage': patch
'@opensaas/stack-storage-s3': patch
'@opensaas/stack-storage-vercel': patch
'@opensaas/stack-tiptap': patch
'@opensaas/stack-rag': patch
---

Fail a package's vitest run with a named, actionable error when its `dist/` was not built from its current `src/`, instead of silently testing stale built output through a cross-package import or a spawned CLI binary.
