---
'@opensaas/stack-rag': patch
---

`OllamaEmbeddingProvider` now refuses a missing or non-positive-integer `dimensions`, naming the model and the bad value, instead of silently accepting it — `dimensions` decides the generated column's width, so a bad value should fail loudly rather than propagate. The `registerEmbeddingProvider('custom', ...)` example in the RAG guidance is corrected to match: it now refuses a missing/invalid `dimensions` instead of silently defaulting to 768.
