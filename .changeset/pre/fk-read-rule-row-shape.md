---
'@opensaas/stack-core': patch
---

Fix foreign-key ids leaking when a relationship `read` rule is row-dependent: `select('<field>Id')` now reads the full row, and a bare read assembles multi-column fields before the rule runs.
