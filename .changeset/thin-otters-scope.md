---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Fix a to-one relationship filter token (e.g. `author:Ada`) leaking related-list data by ANDing the related list's `query` access filter into the nested condition instead of running it unscoped.
