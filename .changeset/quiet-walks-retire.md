---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'create-opensaas-app': patch
---

Internal restructuring: Field Visibility has one implementation, its single traversal; the old walks, the switch between them and the comparison harness are deleted.
