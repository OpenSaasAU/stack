---
'@opensaas/stack-rag': patch
---

Remove `chunking` from `embedding()`, `searchable()` and `ragPlugin()`: it was accepted and silently ignored, since a field is one native vector column per row. Long documents now need a dedicated per-chunk list — documented in the RAG how-to guide.
