---
'@opensaas/stack-core': patch
---

context.db findUnique/findMany now warn (once per list+op) when passed an ignored `select` — narrow reads via `include` or a fragment `query`.
