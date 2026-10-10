---
'@opensaas/stack-rag': patch
---

Clear the stored embedding when its source becomes empty or null, and when regeneration fails on update, so `nearest()` stops matching deleted text.
