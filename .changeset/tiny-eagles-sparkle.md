---
'@opensaas/stack-core': patch
---

Fix nested update/delete (e.g. `post.update({ data: { author: { update: {...} } } })`) silently treating a Prisma filter returned by the target list's `update`/`delete` access as an unconditional allow. It is now re-checked against the target row in the database, matching top-level write behavior.
