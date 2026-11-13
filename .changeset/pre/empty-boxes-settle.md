---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Fix optional JSON, select and text admin fields not clearing to `null`; `json()` now refuses a `null` for a NOT NULL column with an error on the field.
A hook on an optional text field now receives `null`, not `''`, when it's emptied in the admin, so an `=== ''` check no longer fires. Guard with `typeof value === 'string'`, not `?.`, which turns `null` into `undefined` and silently drops the write.
