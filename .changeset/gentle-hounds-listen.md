---
'@opensaas/stack-core': patch
---

Fix: a relation quantifier (`some`/`every`/`none`/`is`/`isNot`) nested inside an `include` entry's own `where` is now scoped by the deeper related list's `query` access and field-read access too, reusing `buildAccessScopedWhere` (#916) — closing a residual probing-oracle gap in #1092's fix.
