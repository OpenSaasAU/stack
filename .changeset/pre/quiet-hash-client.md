---
'@opensaas/stack-cli': patch
---

Fix the dev loop serving a stale client after an additive promote: the generated context now replaces a process-wide client built from a different contract instead of adopting it.
