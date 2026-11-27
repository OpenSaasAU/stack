---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

The admin hides nav entries and dashboard cards for lists the session cannot query, and an item page renders read-only with no Save or Delete when a filter-returning `update`/`delete` rule does not match the row. The session vocabulary now answers `'row-dependent'` for a filter-returning `update` or `delete` rule.
