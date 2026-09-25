---
'@opensaas/stack-rag': patch
---

Fix a security leak where a session denied read access to an `embedding()`'s `sourceField` could still read the embedding's vector, its `sourceHash`, and rank rows with `nearest()` (issue #1627, ADR-0045 amended).
