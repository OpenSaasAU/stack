---
'@opensaas/stack-core': patch
---

Harden relationship count-filter resolution: preserve any sibling conditions co-present in a `_countFilter` marker's AND-member instead of replacing it wholesale, and document why the secured count read intentionally keeps its full projection (`context.db` does not honour `select`).
