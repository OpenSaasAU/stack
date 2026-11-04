---
'@opensaas/stack-rag': patch
---

Fix `findSimilar`'s `excludeSelf` overwriting a caller's own `id` predicate in `where` instead of combining with it.
