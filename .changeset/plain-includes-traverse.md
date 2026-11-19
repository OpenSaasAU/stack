---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

Internal restructuring: Field Visibility's single traversal now also handles reads with plain includes, behind the same internal switch, which still defaults to the existing walks.
