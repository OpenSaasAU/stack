---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix a list/field hook's `context.db` resolving through core's unkeyed default instead of the app's own generated `db` surface, so `context.db.typoedListName` compiled inside a hook and a real list lost its row type. `TypeInfo` now carries the generated `db`, and every hook-args type keys `context` to it.
