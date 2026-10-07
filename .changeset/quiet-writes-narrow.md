---
'@opensaas/stack-core': patch
---

`create`, `update` and `delete` no longer accept `select`/`include`, which were typed but never applied; passing either (or any unknown key) now throws a `ValidationError`. Read the row back with `.where({ id }).include(…).first()` instead.
