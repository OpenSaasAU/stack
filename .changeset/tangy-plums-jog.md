---
'@opensaas/stack-core': patch
---

A caller-supplied `_count` in `include` is now scoped by each named relation's own `query` access (a row filter is folded into the count, a fully denied relation counts `0`), closing a cardinality leak where counts previously reached the caller unscoped.
