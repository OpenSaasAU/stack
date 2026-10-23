---
'@opensaas/stack-core': patch
---

Refuse a non-identifier list key or `db.enumName` at generate time with an error naming it, instead of Prisma's parse error.
