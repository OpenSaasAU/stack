---
'@opensaas/stack-core': patch
---

Fix a field with `isFilterable: false` breaking free-text search: it now has no Filter spec, so it is skipped by bare-word search and the Filter builder.
