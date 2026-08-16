---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

Fix: a relation filter in `where` (`some`/`every`/`none`/`is`/`isNot`) no longer bypasses the related list's `query` access — it is now scoped exactly like `include` already is, recursing through every hop of a chain, on both `findMany` and `count`. A filter through a related list that denies query access now throws `RelationFilterAccessDeniedError` instead of silently running unscoped; field-level `read` access on the related list also now applies to keys named inside the filter. `@opensaas/stack-ui`'s admin list view no longer needs its own relationship label-filter access fold, since the engine now covers it.
