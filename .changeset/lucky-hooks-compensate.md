---
'@opensaas/stack-core': patch
---

Fix a joined write's `beforeTransaction`/`afterTransaction` hooks receiving the transaction-bound context instead of the base client (ADR-0028), which refused a compensating write issued after the enclosing transaction had settled.
