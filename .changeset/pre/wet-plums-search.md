---
'@opensaas/stack-rag': patch
---

`semanticSearch()`/`findSimilar()` now refuse a list with no vector column at compile time, matching `nearest()`'s own refusal, instead of accepting any `fieldName` and throwing at runtime.
