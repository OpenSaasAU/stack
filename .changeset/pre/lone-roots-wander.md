---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

Internal restructuring: Field Visibility gains a single traversal for reads and write returns with no relation nodes, behind an internal switch that defaults to the existing walks.
