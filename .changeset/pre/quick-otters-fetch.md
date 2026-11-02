---
'@opensaas/stack-core': patch
'@opensaas/stack-rag': patch
---

`writePluginOwnedField` now refuses a virtual field by name, instead of falling through to a write the database rejects as an unknown column and the RAG plugin then misreports as retryable.
