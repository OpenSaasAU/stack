---
'@opensaas/stack-cli': patch
---

Fix `TS2589: Type instantiation is excessively deep` in the generated `Context`/`CustomDB` types once a schema grows past ~7-8 lists. `CustomDB`/`BaseContext`/`Context` are now generated as `interface`s (with each list's CRUD methods extracted to a named `{List}Crud` interface) instead of `type` aliases, so `Context.sudo()`'s self-reference no longer forces eager re-expansion of the whole database type (#952).
