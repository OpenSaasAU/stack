---
'@opensaas/stack-core': patch
---

Document that `BulkAction.hasAccess` and `RowAction.hasAccess` show and run an action only on a literal `true`; anything else, or a throw, hides and refuses it.
