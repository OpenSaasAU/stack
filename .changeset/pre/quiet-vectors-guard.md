---
'@opensaas/stack-core': patch
---

Guard `typed-read-surface.test.ts`'s pgvector-dependent test so the Database escape skips it, rather than failing the whole file, on a server without the extension.
