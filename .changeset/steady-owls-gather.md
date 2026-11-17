---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

The Write Pipeline's ownership, singleton and part-column checks ask the List member resolver instead of re-deriving them from the config.
