---
'@opensaas/stack-core': patch
---

Root `update` locks `FOR NO KEY UPDATE`, fixing the deadlock between racers that insert a child and update its parent.
A transaction that then needs `FOR UPDATE` on that row, or changes a column in a unique index, can now deadlock with a racer holding its foreign-key lock (ADR-0078).
