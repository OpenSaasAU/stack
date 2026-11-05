---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Fix optional JSON, select and text admin fields not clearing to `null`: JSON sends `null`, a select offers "Clear selection", and nullable text stores `null` instead of `''`.
`json()` now refuses a `null` for a NOT NULL column with an error on the field.
