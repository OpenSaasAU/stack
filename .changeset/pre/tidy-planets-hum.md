---
'@opensaas/stack-rag': patch
---

Fix `sourceHash` being written by two disagreeing hash implementations, which made the auto-generation skip never match on a row hashed by the other one and forced a redundant paid re-embed on every subsequent write.
