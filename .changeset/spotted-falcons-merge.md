---
'@opensaas/stack-core': patch
---

Fix row-level access bypass when an explicit `include` is passed to non-sudo `findUnique`/`findMany`. The caller's `include` is now merged with (not replaced by) the access-controlled include: denied relations are dropped, each relation's access `where` is AND-combined with any caller nested `where`, and nested includes are filtered at every level. Sudo and query-fragment paths are unchanged. When no access-controlled include is computed (inside a `resolveOutput`/virtual-field context, at max include depth, or for a list with no relationships), the caller's `include` is passed through unchanged rather than dropped — avoiding fail-closed data loss.
