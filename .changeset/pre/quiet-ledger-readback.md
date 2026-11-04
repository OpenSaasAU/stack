---
'@opensaas/stack-core': patch
---

Security fix: a `create`/`update`/`delete` result now respects operation-level `query` access. A session that cannot query the written row gets only the list's system fields back (the write still persists); `sudo()` is unchanged.
