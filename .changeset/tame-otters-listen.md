---
'@opensaas/stack-core': patch
---

Fix `beforeTransaction`/`afterTransaction` hooks not firing for lists reachable only past the involved-list enumeration's old fixed depth cap. These hooks now fire for every list a write touches regardless of nesting depth, so compensation logic that previously never ran will start running — that was a bug, not a contract.
