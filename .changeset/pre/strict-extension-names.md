---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

`generate` refuses a `db.extensions[].name` that is not an identifier or collides with a generated import, before writing anything, and escapes `from` in generated imports.
