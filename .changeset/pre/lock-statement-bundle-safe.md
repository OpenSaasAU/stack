---
'@opensaas/stack-core': patch
---

Fix `update` and `delete` failing for the life of the process when another Next bundle built the client first; the row lock now binds plain values instead of a bundle-local `ParamRef`.
