---
'@opensaas/stack-rag': patch
---

`OllamaEmbeddingProvider.embed()` now fails with a named error (model, declared dimensions, real dimensions) when the model's returned vector doesn't match the declared `dimensions`, instead of writing a mismatched column that only surfaces as an opaque failure at search time.
