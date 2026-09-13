---
'@opensaas/stack-core': patch
---

Fix the test harness's `truncate()` opening a second `pg.Client` beside its declared `max: 1` pool; it now runs through the harness's own client instead.
