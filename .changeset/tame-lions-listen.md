---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix a hook's `context.db` under-describing rows: `TypeInfo` now carries a `db` member (the generator points it at the generated `CustomDB`), so a hook reading a virtual or transformed field off `context.db.<list>` type-checks instead of failing with `TS2339`.
Run `opensaas generate` after upgrading to pick up the new member on `Lists.<List>.TypeInfo`.
