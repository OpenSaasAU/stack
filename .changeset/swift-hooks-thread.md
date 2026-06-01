---
'@opensaas/stack-core': patch
---

Internal refactor: extract the write transform+validate span into a single Hook Pipeline that the Write Pipeline delegates to. No behaviour change.
