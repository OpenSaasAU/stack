---
'@opensaas/stack-core': patch
---

Root `update` locks `FOR NO KEY UPDATE`, fixing the deadlock between racers that insert a child and update its parent.
A transaction that then needs `FOR UPDATE` on that row, or updates a unique column, can now deadlock with such a racer (ADR-0078).
