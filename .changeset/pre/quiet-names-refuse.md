---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

`generate` now refuses fields named `AND`/`OR`/`NOT` (and `some`/`every`/`none` on relationships) and any `db.idField` outside the three strategies; `opensaas init` no longer runs the project name through a shell.
