---
'@opensaas/stack-core': patch
---

Fix a joined write's `afterTransaction` hook receiving the transaction-bound context instead of the base client (ADR-0028), which refused a compensating write issued after the enclosing transaction had settled — while preserving that write's own `sudo()`/`withSession()` elevation.
