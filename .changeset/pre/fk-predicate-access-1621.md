---
'@opensaas/stack-core': patch
---

Scope a `where` on a to-one foreign-key column by the related list's `query` access, and refuse `orderBy`/`distinct`/cursor on it when that access is not open, so a hidden id can no longer be probed.
