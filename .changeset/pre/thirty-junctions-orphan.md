---
'@opensaas/stack-ui': patch
---

The admin item view's relationship-table row removal now defaults to `'delete'` for a section backed by an explicit junction list, instead of `'disconnect'`, so removing an edge no longer leaves an orphaned junction row pointing at only one endpoint. An ordinary to-many back-reference still defaults to `'disconnect'`, and an explicit `removeAction` continues to win over the default in both cases.
