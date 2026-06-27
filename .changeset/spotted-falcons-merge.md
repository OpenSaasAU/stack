---
'@opensaas/stack-core': patch
---

Fix row-level access bypass when an explicit `include` is passed to non-sudo `findUnique`/`findMany`. The caller's `include` is now merged with (not replaced by) the access-controlled include: denied relations are dropped, each relation's access `where` is AND-combined with any caller nested `where`, and nested includes are filtered at every level. Sudo and query-fragment paths are unchanged.
