---
'@opensaas/stack-core': patch
---

Fix a nested create/update/delete through a list-only ref's synthetic reverse relation (`from_<List>_<field>`) silently bypassing the target list's hooks and validation. It now runs the same pipeline a declared relationship field's nested write gets. Under `sudo()`, an undeclared key that isn't a synthetic reverse relation is now refused rather than passed through unchecked.
