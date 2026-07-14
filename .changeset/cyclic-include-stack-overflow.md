---
'@opensaas/stack-core': patch
---

Fix stack overflow when auto-including relationships on a cyclic readable-relationship graph. The auto-include now stops at cycle back-edges (a relation that closes a cycle is fetched flat) instead of re-descending to MAX_DEPTH.
