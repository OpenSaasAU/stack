---
'@opensaas/stack-core': patch
---

Fix `select()` inside a synthetic back-relation include skipping the source field's row-dependent `read` rule, which leaked or hid rows depending on the projection.
