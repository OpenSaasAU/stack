---
'@opensaas/stack-core': patch
---

The write pipeline's per-write ORM handle reconciliation now derives the list-to-namespace shape once per context, reused on every write's transaction, instead of re-walking `config.lists` on each write.
