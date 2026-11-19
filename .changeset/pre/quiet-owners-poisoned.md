---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

A failed declared-rows fetch for a caller-shaped include now poisons its transaction owner, as every other engine read does.
