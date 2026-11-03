---
'@opensaas/stack-rag': patch
---

`pnpm generate` now warns for each `embedding({ index })` field that no vector index is built, and the `index` docs no longer pin a pgvector version.
