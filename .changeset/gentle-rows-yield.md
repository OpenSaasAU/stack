---
'@opensaas/stack-core': patch
---

Root `update` takes `FOR NO KEY UPDATE` on its target, so it no longer deadlocks against a concurrent child insert's foreign-key lock.
