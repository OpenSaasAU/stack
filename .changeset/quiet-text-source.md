---
'@opensaas/stack-rag': patch
---

`searchable()` now requires a `text()` source: other types fail `opensaas generate`, and a non-string source value at runtime logs a one-time warning instead of silently skipping the embedding.
