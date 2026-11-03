---
'@opensaas/stack-cli': patch
'@opensaas/stack-core': patch
---

Quote every import specifier the generator writes and refuse a `db.extensions[].from` that is not a package name.
