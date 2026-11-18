---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

Internal restructuring: every write return now goes through Field Visibility's read funnel and carries the visible-row brand.
